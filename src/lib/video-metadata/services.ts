import { createHash, randomUUID } from "node:crypto";
import { emitAuditEvent, getCredentialUserId } from "./adapters/logger";
import { YOUTUBE_READ_SCOPE, YOUTUBE_WRITE_SCOPE } from "@/lib/auth";
import type { QuotaAccountant } from "../quota/accountant";
import {
  DomainError,
  isDomainError,
  type MetadataLanguageSource,
  type MetadataApplyResult,
  type MetadataDraft,
  type MetadataSyncProposal,
  type ResolvedCredentials,
  type TranscriptResult,
  type VideoMetadataContext,
  type VideoMetadataItem,
} from "./contracts";
import {
  applyMetadataInputSchema,
  applyMetadataOutputSchema,
  confirmMetadataBatchInputSchema,
  confirmMetadataBatchOutputSchema,
  executeMetadataBatchInputSchema,
  executeMetadataBatchOutputSchema,
  listVideosInputSchema,
  listVideosOutputSchema,
  metadataDraftSchema,
  parseWithSchema,
  previewMetadataBatchInputSchema,
  previewMetadataBatchOutputSchema,
  previewMetadataInputSchema,
  previewMetadataOutputSchema,
  transcriptInputSchema,
  transcriptOutputSchema,
} from "./schemas";

type ServiceDependencies = {
  authResolver: {
    resolve(args: {
      credentialRef: unknown;
      requiredScopes: readonly string[];
    }): Promise<ResolvedCredentials>;
  };
  youtubeApi: {
    listVideos(args: {
      credentials: ResolvedCredentials;
      channelId?: string;
      maxResults?: number;
      operationId?: string;
      quotaAccountant?: QuotaAccountant;
    }): Promise<VideoMetadataItem[]>;
    getVideo(args: {
      credentials: ResolvedCredentials;
      videoId: string;
    }): Promise<VideoMetadataItem>;
    getVideoMetadataContext(args: {
      credentials: ResolvedCredentials;
      videoId: string;
    }): Promise<VideoMetadataContext>;
    applyMetadataProposal(args: {
      credentials: ResolvedCredentials;
      proposal: MetadataSyncProposal;
    }): Promise<void>;
  };
  transcriptProvider: {
    getTranscript(args: {
      credentials?: ResolvedCredentials;
      videoId: string;
      provider?: string;
    }): Promise<TranscriptResult>;
  };
  metadataGenerator: {
    generate(args: {
      video: VideoMetadataItem;
      transcript: TranscriptResult;
      editorialPrompt: string;
    }): Promise<MetadataDraft>;
  };
  logger: {
    info(payload: { event: string; context?: Record<string, unknown> }): void;
    error(payload: { event: string; context?: Record<string, unknown> }): void;
  };
  writeContext: {
    assertWriteChannel(args: {
      credentialRef: unknown;
      credentials: ResolvedCredentials;
      expectedChannelId?: string;
    }): Promise<{
      expectedChannelId: string;
      shouldPersistSelection: boolean;
      userId: string | null;
    }>;
  };
  channelSelectionStore: {
    setSelectedChannelId(userId: string, channelId: string): Promise<void>;
  };
  operationIdFactory?: () => string;
  quotaAccountant?: QuotaAccountant;
};

export type { ServiceDependencies };

function mapUnknownError(error: unknown, fallbackCode: DomainError["code"]) {
  if (isDomainError(error)) return error;

  return new DomainError({
    code: fallbackCode,
    message: error instanceof Error ? error.message : "Unknown error",
  });
}

function removeReadOnlySnippetFields(snippet: Record<string, unknown>) {
  const sanitized = { ...snippet };
  delete sanitized.localized;
  return sanitized;
}

function resolveTargetLanguage(context: VideoMetadataContext): {
  targetLanguage: string;
  languageSource: MetadataLanguageSource;
} {
  const defaultLanguage =
    typeof context.snippet.defaultLanguage === "string" &&
    context.snippet.defaultLanguage.trim().length > 0
      ? context.snippet.defaultLanguage.trim()
      : null;

  if (defaultLanguage) {
    return {
      targetLanguage: defaultLanguage,
      languageSource: "defaultLanguage",
    };
  }

  const localizationLocales = Object.keys(context.localizations);
  if (localizationLocales.length === 1) {
    const [inferredLanguage] = localizationLocales;
    if (!inferredLanguage) {
      throw new DomainError({
        code: "target_language_unresolvable",
        message: "Cannot resolve target language from YouTube metadata",
      });
    }

    return {
      targetLanguage: inferredLanguage,
      languageSource: "existing-localization",
    };
  }

  throw new DomainError({
    code: "target_language_unresolvable",
    message:
      "Cannot resolve target language. Set snippet.defaultLanguage on the video or leave exactly one localization.",
    details: {
      videoDefaultLanguage: context.snippet.defaultLanguage ?? null,
      localizationLocales,
    },
  });
}

function buildMetadataSyncProposal(args: {
  videoId: string;
  context: VideoMetadataContext;
  draft: MetadataDraft;
}): MetadataSyncProposal {
  const resolvedLanguage = resolveTargetLanguage(args.context);
  const beforeSnippet = removeReadOnlySnippetFields(args.context.snippet);
  const proposedSnippet = removeReadOnlySnippetFields({
    ...beforeSnippet,
    title: args.draft.finalTitle,
    description: args.draft.description,
    defaultLanguage: resolvedLanguage.targetLanguage,
  });

  const beforeLocalizations = { ...args.context.localizations };
  const proposedLocalizations = {
    ...beforeLocalizations,
    [resolvedLanguage.targetLanguage]: {
      ...beforeLocalizations[resolvedLanguage.targetLanguage],
      title: args.draft.finalTitle,
      description: args.draft.description,
    },
  };

  return {
    targetLanguage: resolvedLanguage.targetLanguage,
    languageSource: resolvedLanguage.languageSource,
    snippet: {
      before: beforeSnippet,
      proposed: proposedSnippet,
    },
    localizations: {
      before: beforeLocalizations,
      proposed: proposedLocalizations,
      affected: [
        {
          locale: resolvedLanguage.targetLanguage,
          before: beforeLocalizations[resolvedLanguage.targetLanguage] ?? null,
          proposed: proposedLocalizations[resolvedLanguage.targetLanguage],
          source: resolvedLanguage.languageSource,
        },
      ],
    },
    update: {
      videoId: args.videoId,
      snippet: proposedSnippet,
      localizations: proposedLocalizations,
    },
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function confirmationIdFor(input: { items: unknown; expectedChannelId: string; confirmed: true }) {
  return createHash("sha256").update(JSON.stringify(canonicalize({
    items: input.items, expectedChannelId: input.expectedChannelId, confirmed: input.confirmed,
  }))).digest("hex");
}

export function createVideoMetadataServices(deps: ServiceDependencies) {
  return {
    async listVideos(input: unknown) {
      const parsedInput = parseWithSchema(listVideosInputSchema, input, "list videos input");
      const operationId = deps.operationIdFactory?.() ?? randomUUID();
      const audit = (phase: string, extra: Record<string, unknown> = {}) => emitAuditEvent(deps.logger, `video_metadata.list.${phase}`, { operationId, channelId: parsedInput.channelId, ...extra }, getCredentialUserId(parsedInput.credentialRef));
      audit("start");
      try {
        const credentials = await deps.authResolver.resolve({
          credentialRef: parsedInput.credentialRef,
          requiredScopes: [YOUTUBE_READ_SCOPE],
        });

        const videos = await deps.youtubeApi.listVideos({
          credentials,
          channelId: parsedInput.channelId,
          maxResults: parsedInput.maxResults,
          operationId,
          quotaAccountant: deps.quotaAccountant,
        });

        const output = parseWithSchema(
          listVideosOutputSchema,
          { videos },
          "list videos output"
        );

        audit("success", { count: output.videos.length });

        return output;
      } catch (error) {
        const mapped = mapUnknownError(error, "unauthorized");
        audit("failure", { code: mapped.code });
        throw mapped;
      }
    },

    async getTranscript(input: unknown) {
      const parsedInput = parseWithSchema(transcriptInputSchema, input, "transcript input");
      const operationId = deps.operationIdFactory?.() ?? randomUUID();
      const audit = (phase: string, extra: Record<string, unknown> = {}) => emitAuditEvent(deps.logger, `transcript.get.${phase}`, { operationId, videoId: parsedInput.videoId, ...extra }, getCredentialUserId(parsedInput.credentialRef));
      audit("start");
      try {
        const selectedProvider = parsedInput.provider ?? process.env.YOUTUBE_TRANSCRIPT_PROVIDER ?? "youtube-captions";
        if (selectedProvider === "youtube-captions" && !parsedInput.credentialRef) {
          throw new DomainError({ code: "validation_failed", message: "Transcript credentials are required for youtube-captions" });
        }
        const credentials = selectedProvider === "youtube-captions"
          ? await deps.authResolver.resolve({
              credentialRef: parsedInput.credentialRef,
              requiredScopes: [YOUTUBE_READ_SCOPE],
            })
          : undefined;

        const transcript = await deps.transcriptProvider.getTranscript({
          ...(credentials ? { credentials } : {}),
          videoId: parsedInput.videoId,
          provider: selectedProvider,
        });

        const output = parseWithSchema(
          transcriptOutputSchema,
          { transcript },
          "transcript output"
        );

        audit("success", { transcriptStatus: output.transcript.status });
        return output;
      } catch (error) {
        const mapped = mapUnknownError(error, "transcript_unavailable");
        audit("failure", { code: mapped.code });
        throw mapped;
      }
    },

    async previewMetadata(input: unknown) {
      const parsedInput = parseWithSchema(
        previewMetadataInputSchema,
        input,
        "preview metadata input"
      );
      const operationId = deps.operationIdFactory?.() ?? randomUUID();
      const audit = (phase: string, extra: Record<string, unknown> = {}) => emitAuditEvent(deps.logger, `video_metadata.preview.${phase}`, { operationId, videoId: parsedInput.videoId, ...extra }, getCredentialUserId(parsedInput.credentialRef));
      audit("start");
      try {
        const credentials = await deps.authResolver.resolve({
          credentialRef: parsedInput.credentialRef,
          requiredScopes: [YOUTUBE_READ_SCOPE],
        });

        const video = await deps.youtubeApi.getVideo({
          credentials,
          videoId: parsedInput.videoId,
        });

        const transcriptResult = await deps.transcriptProvider.getTranscript({
          credentials,
          videoId: parsedInput.videoId,
        });

        const draft = await deps.metadataGenerator.generate({
          video,
          transcript: transcriptResult,
          editorialPrompt: parsedInput.editorialPrompt,
        });

        const output = parseWithSchema(
          previewMetadataOutputSchema,
          {
            video,
            transcript: transcriptResult,
            draft,
          },
          "preview metadata output"
        );

        audit("success", { transcriptStatus: output.transcript.status });

        return output;
      } catch (error) {
        const mapped = mapUnknownError(error, "generation_failed");
        audit("failure", { code: mapped.code });
        throw mapped;
      }
    },

    async previewMetadataBatch(input: unknown) {
      const parsedInput = parseWithSchema(
        previewMetadataBatchInputSchema,
        input,
        "batch preview metadata input"
      );
      const items = [];
      for (const videoId of parsedInput.videoIds) {
        items.push(await this.previewMetadata({
          credentialRef: parsedInput.credentialRef,
          videoId,
          editorialPrompt: parsedInput.editorialPrompt,
        }));
      }
      return parseWithSchema(
        previewMetadataBatchOutputSchema,
        { items },
        "batch preview metadata output"
      );
    },

    async confirmMetadataBatch(input: unknown) {
      const parsedInput = parseWithSchema(
        confirmMetadataBatchInputSchema,
        input,
        "batch metadata confirmation input"
      );
      // The identity excludes credentials and uses schema-defined key ordering.
      const canonicalPayload = {
        items: parsedInput.items,
        expectedChannelId: parsedInput.expectedChannelId,
        confirmed: parsedInput.confirmed,
      };
      const confirmationId = confirmationIdFor(canonicalPayload);

      return parseWithSchema(
        confirmMetadataBatchOutputSchema,
        { ...canonicalPayload, confirmationId },
        "batch metadata confirmation output"
      );
    },

    async executeMetadataBatch(input: unknown) {
      const parsed = parseWithSchema(executeMetadataBatchInputSchema, input, "batch metadata execution input");
      if (confirmationIdFor(parsed) !== parsed.confirmationId) {
        throw new DomainError({ code: "validation_failed", message: "Confirmation envelope does not match confirmationId" });
      }
      let credentials: ResolvedCredentials;
      try {
        credentials = await deps.authResolver.resolve({ credentialRef: parsed.credentialRef, requiredScopes: [YOUTUBE_WRITE_SCOPE] });
      } catch (error) {
        throw mapUnknownError(error, "unauthorized");
      }
      try {
        const guardrail = await deps.writeContext.assertWriteChannel({
          credentialRef: parsed.credentialRef, credentials, expectedChannelId: parsed.expectedChannelId,
        });
        const proposals: MetadataSyncProposal[] = [];
        for (const item of parsed.items) {
          const context = await deps.youtubeApi.getVideoMetadataContext({ credentials, videoId: item.videoId });
          if (context.snippet.channelId !== parsed.expectedChannelId) {
            throw new DomainError({ code: "WRITE_CHANNEL_MISMATCH", message: "Video does not belong to the expected write channel", details: { videoId: item.videoId } });
          }
          const baseline = { title: context.snippet.title, description: context.snippet.description, localizations: context.localizations };
          if (JSON.stringify(canonicalize(baseline)) !== JSON.stringify(canonicalize(item.baseline))) {
            throw new DomainError({ code: "validation_failed", message: "Confirmed metadata is stale", details: { videoId: item.videoId } });
          }
          proposals.push(buildMetadataSyncProposal({ videoId: item.videoId, context, draft: {
            finalTitle: item.proposedTitle, description: item.proposedDescription, promptVersion: "confirmed-batch",
          } }));
        }
        const outcomes: Array<{ videoId: string; status: "success" } | { videoId: string; status: "provider-failure"; error: { code: string; message: string } }> = [];
        for (const proposal of proposals) {
          try {
            await deps.youtubeApi.applyMetadataProposal({ credentials, proposal });
            outcomes.push({ videoId: proposal.update.videoId, status: "success" });
          } catch (error) {
            const mapped = mapUnknownError(error, "update_failed");
            outcomes.push({ videoId: proposal.update.videoId, status: "provider-failure", error: { code: mapped.code, message: mapped.message } });
          }
        }
        if (guardrail.shouldPersistSelection && guardrail.userId) {
          await deps.channelSelectionStore.setSelectedChannelId(guardrail.userId, guardrail.expectedChannelId);
        }
        return parseWithSchema(executeMetadataBatchOutputSchema, {
          confirmationId: parsed.confirmationId, expectedChannelId: parsed.expectedChannelId, outcomes,
        }, "batch metadata execution output");
      } catch (error) {
        throw mapUnknownError(error, "update_failed");
      }
    },

    async applyMetadata(input: unknown): Promise<MetadataApplyResult> {
      const parsedInput = parseWithSchema(
        applyMetadataInputSchema,
        input,
        "apply metadata input"
      );

      const draft = parseWithSchema(
        metadataDraftSchema,
        {
          finalTitle: parsedInput.finalTitle,
          description: parsedInput.description,
          promptVersion: "manual-input",
        },
        "metadata draft"
      );
      const operationId = deps.operationIdFactory?.() ?? randomUUID();
      let channelId: string | undefined;
      const audit = (phase: string, extra: Record<string, unknown> = {}) => emitAuditEvent(deps.logger, `video_metadata.apply.${phase}`, { operationId, channelId, videoId: parsedInput.videoId, dryRun: parsedInput.dryRun ?? false, ...extra }, getCredentialUserId(parsedInput.credentialRef));
      audit("start");
      try {
        const credentials = await deps.authResolver.resolve({
          credentialRef: parsedInput.credentialRef,
          requiredScopes: [YOUTUBE_WRITE_SCOPE],
        });

        const guardrail = await deps.writeContext.assertWriteChannel({
          credentialRef: parsedInput.credentialRef,
          credentials,
          expectedChannelId: parsedInput.expectedChannelId,
        });

        channelId = guardrail.expectedChannelId;
        const metadataContext = await deps.youtubeApi.getVideoMetadataContext({
          credentials,
          videoId: parsedInput.videoId,
        });

        const proposal = buildMetadataSyncProposal({
          videoId: parsedInput.videoId,
          context: metadataContext,
          draft,
        });

        if (parsedInput.dryRun) {
          const output = parseWithSchema(
            applyMetadataOutputSchema,
            {
              dryRun: true,
              videoId: parsedInput.videoId,
              targetLanguage: proposal.targetLanguage,
              languageSource: proposal.languageSource,
              snippet: proposal.snippet,
              localizations: proposal.localizations,
            },
            "apply metadata output"
          );
          audit("dry_run");
          return output;
        }

        await deps.youtubeApi.applyMetadataProposal({
          credentials,
          proposal,
        });

        if (guardrail.shouldPersistSelection && guardrail.userId) {
          await deps.channelSelectionStore.setSelectedChannelId(
            guardrail.userId,
            guardrail.expectedChannelId
          );
        }

        const output = parseWithSchema(
          applyMetadataOutputSchema,
          {
            dryRun: false,
            videoId: parsedInput.videoId,
            targetLanguage: proposal.targetLanguage,
            languageSource: proposal.languageSource,
            snippet: proposal.snippet,
            localizations: proposal.localizations,
          },
          "apply metadata output"
        );

        audit("success");

        return output;
      } catch (error) {
        const mapped = mapUnknownError(error, "update_failed");
        audit("failure", { code: mapped.code });
        throw mapped;
      }
    },
  };
}
