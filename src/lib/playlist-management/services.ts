import { randomUUID } from "node:crypto";
import { emitAuditEvent, getCredentialUserId, type VideoMetadataLogger } from "../video-metadata/adapters/logger";
import { YOUTUBE_READ_SCOPE, YOUTUBE_WRITE_SCOPE } from "@/lib/auth";
import type { QuotaAccountant, QuotaOperation } from "../quota/accountant";
import {
  DomainError,
  type DeletePlaylistResult,
  isDomainError,
  type AddVideosResult,
  type Playlist,
  type PlaylistMutationFailure,
  type PlaylistMutationFailureReason,
  type PlaylistPrivacyStatus,
  type RemoveVideosResult,
  type ResolvedCredentials,
  type UpdatePlaylistResult,
} from "./contracts";
import {
  parseWithSchema,
  playlistAddVideosInputSchema,
  playlistAddVideosOutputSchema,
  playlistCreateInputSchema,
  playlistCreateOutputSchema,
  playlistDeleteInputSchema,
  playlistDeleteOutputSchema,
  playlistListInputSchema,
  playlistListOutputSchema,
  playlistRemoveVideosInputSchema,
  playlistRemoveVideosOutputSchema,
  playlistUpdateInputSchema,
  playlistUpdateOutputSchema,
} from "./schemas";

type ServiceDependencies = {
  authResolver: {
    resolve(args: {
      credentialRef: unknown;
      requiredScopes: readonly string[];
    }): Promise<ResolvedCredentials>;
  };
  youtubeApi: {
    listPlaylists(args: { credentials: ResolvedCredentials; operationId?: string; quotaAccountant?: QuotaAccountant }): Promise<Playlist[]>;
    createPlaylist(args: {
      credentials: ResolvedCredentials;
      title: string;
      description?: string;
      privacyStatus: PlaylistPrivacyStatus;
      operationId?: string;
      quotaAccountant?: QuotaAccountant;
      channelId?: string;
    }): Promise<Playlist>;
    getPlaylistForUpdate(args: {
      credentials: ResolvedCredentials;
      playlistId: string;
      operationId?: string;
      quotaAccountant?: QuotaAccountant;
      channelId?: string;
    }): Promise<(Playlist & { channelId: string }) | null>;
    updatePlaylist(args: {
      credentials: ResolvedCredentials;
      playlistId: string;
      title: string;
      description: string;
      privacyStatus: PlaylistPrivacyStatus;
      operationId?: string;
      quotaAccountant?: QuotaAccountant;
      channelId?: string;
    }): Promise<Playlist>;
    getPlaylistForDelete(args: {
      credentials: ResolvedCredentials;
      playlistId: string;
    }): Promise<{ id: string; channelId: string; title: string } | null>;
    deletePlaylist(args: {
      credentials: ResolvedCredentials;
      playlistId: string;
    }): Promise<void>;
    addVideoToPlaylist(args: {
      credentials: ResolvedCredentials;
      playlistId: string;
      videoId: string;
    }): Promise<void>;
    listPlaylistItemIdsByVideo(args: {
      credentials: ResolvedCredentials;
      playlistId: string;
      operationId?: string;
      quotaAccountant?: QuotaAccountant;
      channelId?: string;
    }): Promise<Map<string, string[]>>;
    deletePlaylistItem(args: {
      credentials: ResolvedCredentials;
      playlistItemId: string;
    }): Promise<void>;
  };
  writeContext: {
    assertWriteChannel(args: {
      credentialRef: unknown;
      credentials: ResolvedCredentials;
      expectedChannelId?: string;
    }): Promise<{
      expectedChannelId: string;
      activeWriteChannel: { id: string; title: string | null };
      shouldPersistSelection: boolean;
      userId: string | null;
    }>;
  };
  channelSelectionStore: {
    setSelectedChannelId(userId: string, channelId: string): Promise<void>;
  };
  operationIdFactory?: () => string;
  quotaAccountant?: QuotaAccountant;
  logger?: VideoMetadataLogger;
};

function auditScope(deps: ServiceDependencies, operation: string, operationId: string, target: Record<string, unknown> = {}, userId?: string | null) {
  let channelId: string | undefined;
  const emit = (phase: string, extra: Record<string, unknown> = {}) => emitAuditEvent(deps.logger, `playlist.${operation}.${phase}`, { operationId, channelId, ...target, ...extra }, userId);
  emit("start");
  return { emit, setChannelId: (id: string) => { channelId = id; } };
}

function safeAccount(accountant: QuotaAccountant | undefined, operationId: string, operation: QuotaOperation, channelId?: string) {
  try {
    accountant?.record({ operationId, operation, ...(channelId ? { channelId } : {}) });
  } catch {
    // Accounting is observational.
  }
}

function mapUnknownError(error: unknown, fallbackCode: DomainError["code"]) {
  if (isDomainError(error)) return error;

  return new DomainError({
    code: fallbackCode,
    message: error instanceof Error ? error.message : "Unknown error",
  });
}

function classifyYoutubeMutationError(
  error: unknown,
  context: "add" | "remove"
): { reason: PlaylistMutationFailureReason; message?: string } {
  if (error instanceof DomainError) {
    return {
      reason: "unknown",
      message: error.message,
    };
  }

  const maybeResponse =
    error && typeof error === "object" && "response" in error
      ? (error as { response?: { status?: number; data?: unknown } }).response
      : undefined;
  const status = maybeResponse?.status;

  const errorReason =
    maybeResponse?.data &&
    typeof maybeResponse.data === "object" &&
    "error" in maybeResponse.data
      ? (maybeResponse.data as { error?: { errors?: Array<{ reason?: string }> } }).error
          ?.errors?.[0]?.reason
      : undefined;

  const normalizedReason = errorReason?.toLowerCase();

  if (
    context === "add" &&
    (status === 409 ||
      normalizedReason === "duplicate" ||
      normalizedReason === "playlistcontainsduplicatevideos")
  ) {
    return { reason: "already-present", message: error instanceof Error ? error.message : undefined };
  }

  if (status === 403) {
    return { reason: "forbidden", message: error instanceof Error ? error.message : undefined };
  }

  if (context === "remove" && status === 404) {
    return {
      reason: "not-found-in-playlist",
      message: error instanceof Error ? error.message : undefined,
    };
  }

  if (status && status >= 400) {
    return { reason: "api-error", message: error instanceof Error ? error.message : undefined };
  }

  return { reason: "unknown", message: error instanceof Error ? error.message : undefined };
}

export function createPlaylistManagementServices(deps: ServiceDependencies) {
  return {
    async listPlaylists(input: unknown) {
      const parsedInput = parseWithSchema(playlistListInputSchema, input, "playlist list input");
      const operationId = deps.operationIdFactory?.() ?? randomUUID();
      const audit = auditScope(deps, "list", operationId, {}, getCredentialUserId(parsedInput.credentialRef));
      try {
        const credentials = await deps.authResolver.resolve({
          credentialRef: parsedInput.credentialRef,
          requiredScopes: [YOUTUBE_READ_SCOPE],
        });

        const playlists = await deps.youtubeApi.listPlaylists({ credentials, operationId, quotaAccountant: deps.quotaAccountant });
        const output = parseWithSchema(playlistListOutputSchema, { playlists }, "playlist list output");
        audit.emit("success", { count: output.playlists.length });
        return output;
      } catch (error) {
        const mapped = mapUnknownError(error, "unauthorized");
        audit.emit("failure", { code: mapped.code });
        throw mapped;
      }
    },

    async createPlaylist(input: unknown) {
      const parsedInput = parseWithSchema(
        playlistCreateInputSchema,
        input,
        "playlist create input"
      );
      const operationId = deps.operationIdFactory?.() ?? randomUUID();
      const audit = auditScope(deps, "create", operationId, {}, getCredentialUserId(parsedInput.credentialRef));
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

        audit.setChannelId(guardrail.expectedChannelId);
        safeAccount(deps.quotaAccountant, operationId, "playlists.insert", guardrail.expectedChannelId);
        const playlist = await deps.youtubeApi.createPlaylist({
          credentials,
          operationId,
          quotaAccountant: deps.quotaAccountant,
          channelId: guardrail.expectedChannelId,
          title: parsedInput.title.trim(),
          description: parsedInput.description,
          privacyStatus: parsedInput.privacyStatus,
        });

        if (guardrail.shouldPersistSelection && guardrail.userId) {
          await deps.channelSelectionStore.setSelectedChannelId(
            guardrail.userId,
            guardrail.expectedChannelId
          );
        }

        const output = parseWithSchema(playlistCreateOutputSchema, { playlist }, "playlist create output");
        audit.emit("success", { playlistId: output.playlist.id });
        return output;
      } catch (error) {
        const mapped = mapUnknownError(error, "update_failed");
        audit.emit("failure", { code: mapped.code });
        throw mapped;
      }
    },

    async updatePlaylist(input: unknown): Promise<UpdatePlaylistResult> {
      const parsedInput = parseWithSchema(
        playlistUpdateInputSchema,
        input,
        "playlist update input"
      );
      const operationId = deps.operationIdFactory?.() ?? randomUUID();
      const audit = auditScope(deps, "update", operationId, { playlistId: parsedInput.playlistId }, getCredentialUserId(parsedInput.credentialRef));
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

        audit.setChannelId(guardrail.activeWriteChannel.id);
        const currentPlaylist = await deps.youtubeApi.getPlaylistForUpdate({
          credentials,
          playlistId: parsedInput.playlistId,
          operationId,
          quotaAccountant: deps.quotaAccountant,
          channelId: guardrail.activeWriteChannel.id,
        });

        if (!currentPlaylist) {
          throw new DomainError({
            code: "not_found",
            message: "Playlist not found",
            details: { playlistId: parsedInput.playlistId },
          });
        }

        if (currentPlaylist.channelId !== guardrail.activeWriteChannel.id) {
          throw new DomainError({
            code: "WRITE_CHANNEL_MISMATCH",
            message: "Playlist does not belong to the active write channel",
            details: {
              expectedChannelId: guardrail.expectedChannelId,
              activeWriteChannelId: currentPlaylist.channelId,
            },
          });
        }

        safeAccount(deps.quotaAccountant, operationId, "playlists.update", guardrail.activeWriteChannel.id);
        const playlist = await deps.youtubeApi.updatePlaylist({
          credentials,
          playlistId: parsedInput.playlistId,
          operationId,
          quotaAccountant: deps.quotaAccountant,
          channelId: guardrail.activeWriteChannel.id,
          title: parsedInput.title ?? currentPlaylist.title,
          description:
            parsedInput.description !== undefined
              ? parsedInput.description
              : currentPlaylist.description,
          privacyStatus: parsedInput.privacyStatus ?? currentPlaylist.privacyStatus,
        });

        if (guardrail.shouldPersistSelection && guardrail.userId) {
          await deps.channelSelectionStore.setSelectedChannelId(
            guardrail.userId,
            guardrail.expectedChannelId
          );
        }

        const output = parseWithSchema(
          playlistUpdateOutputSchema,
          { playlist },
          "playlist update output"
        );
        audit.emit("success");
        return output;
      } catch (error) {
        const mapped = mapUnknownError(error, "update_failed");
        audit.emit("failure", { code: mapped.code });
        throw mapped;
      }
    },

    async deletePlaylist(input: unknown): Promise<DeletePlaylistResult> {
      const parsedInput = parseWithSchema(
        playlistDeleteInputSchema,
        input,
        "playlist delete input"
      );
      const audit = auditScope(deps, "delete", deps.operationIdFactory?.() ?? randomUUID(), { playlistId: parsedInput.playlistId }, getCredentialUserId(parsedInput.credentialRef));
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

        audit.setChannelId(guardrail.activeWriteChannel.id);
        const playlist = await deps.youtubeApi.getPlaylistForDelete({
          credentials,
          playlistId: parsedInput.playlistId,
        });

        if (!playlist) {
          throw new DomainError({
            code: "not_found",
            message: "Playlist not found",
            details: { playlistId: parsedInput.playlistId },
          });
        }

        if (playlist.channelId !== guardrail.activeWriteChannel.id) {
          throw new DomainError({
            code: "WRITE_CHANNEL_MISMATCH",
            message: "Playlist does not belong to the active write channel",
            details: {
              expectedChannelId: guardrail.expectedChannelId,
              activeWriteChannelId: playlist.channelId,
            },
          });
        }

        await deps.youtubeApi.deletePlaylist({
          credentials,
          playlistId: parsedInput.playlistId,
        });

        if (guardrail.shouldPersistSelection && guardrail.userId) {
          await deps.channelSelectionStore.setSelectedChannelId(
            guardrail.userId,
            guardrail.expectedChannelId
          );
        }

        const output = parseWithSchema(
          playlistDeleteOutputSchema,
          {
            deleted: true,
            playlistId: parsedInput.playlistId,
          },
          "playlist delete output"
        );
        audit.emit("success");
        return output;
      } catch (error) {
        const mapped = mapUnknownError(error, "update_failed");
        audit.emit("failure", { code: mapped.code });
        throw mapped;
      }
    },

    async addVideosToPlaylist(input: unknown): Promise<AddVideosResult> {
      const parsedInput = parseWithSchema(
        playlistAddVideosInputSchema,
        input,
        "playlist add videos input"
      );
      const audit = auditScope(deps, "add_videos", deps.operationIdFactory?.() ?? randomUUID(), { playlistId: parsedInput.playlistId }, getCredentialUserId(parsedInput.credentialRef));
      try {
        const credentials = await deps.authResolver.resolve({
          credentialRef: parsedInput.credentialRef,
          requiredScopes: [YOUTUBE_WRITE_SCOPE],
        });

        let added = 0;
        const failures: PlaylistMutationFailure[] = [];

        for (const videoId of parsedInput.videoIds) {
          try {
            await deps.youtubeApi.addVideoToPlaylist({
              credentials,
              playlistId: parsedInput.playlistId,
              videoId,
            });
            added += 1;
          } catch (error) {
            const classified = classifyYoutubeMutationError(error, "add");
            failures.push({
              videoId,
              reason: classified.reason,
              ...(classified.message ? { message: classified.message } : {}),
            });
          }
        }

        const output = parseWithSchema(
          playlistAddVideosOutputSchema,
          {
            playlistId: parsedInput.playlistId,
            attempted: parsedInput.videoIds.length,
            added,
            failures,
          },
          "playlist add videos output"
        );
        audit.emit("success", { count: output.added });
        return output;
      } catch (error) {
        const mapped = mapUnknownError(error, "update_failed");
        audit.emit("failure", { code: mapped.code });
        throw mapped;
      }
    },

    async removeVideosFromPlaylist(input: unknown): Promise<RemoveVideosResult> {
      const parsedInput = parseWithSchema(
        playlistRemoveVideosInputSchema,
        input,
        "playlist remove videos input"
      );
      const operationId = deps.operationIdFactory?.() ?? randomUUID();
      const audit = auditScope(deps, "remove_videos", operationId, { playlistId: parsedInput.playlistId }, getCredentialUserId(parsedInput.credentialRef));
      try {
        const credentials = await deps.authResolver.resolve({
          credentialRef: parsedInput.credentialRef,
          requiredScopes: [YOUTUBE_WRITE_SCOPE],
        });

        const itemIdsByVideo = await deps.youtubeApi.listPlaylistItemIdsByVideo({
          credentials,
          playlistId: parsedInput.playlistId,
          operationId,
          quotaAccountant: deps.quotaAccountant,
        });

        let removed = 0;
        const failures: PlaylistMutationFailure[] = [];

        for (const videoId of parsedInput.videoIds) {
          const candidateIds = itemIdsByVideo.get(videoId);
          const playlistItemId = candidateIds?.shift();

          if (!playlistItemId) {
            failures.push({
              videoId,
              reason: "not-found-in-playlist",
              message: "Video is not present in playlist",
            });
            continue;
          }

          try {
            await deps.youtubeApi.deletePlaylistItem({
              credentials,
              playlistItemId,
            });
            removed += 1;
          } catch (error) {
            const classified = classifyYoutubeMutationError(error, "remove");
            failures.push({
              videoId,
              reason: classified.reason,
              ...(classified.message ? { message: classified.message } : {}),
            });
          }
        }

        const output = parseWithSchema(
          playlistRemoveVideosOutputSchema,
          {
            playlistId: parsedInput.playlistId,
            requested: parsedInput.videoIds.length,
            removed,
            failures,
          },
          "playlist remove videos output"
        );
        audit.emit("success", { count: output.removed });
        return output;
      } catch (error) {
        const mapped = mapUnknownError(error, "update_failed");
        audit.emit("failure", { code: mapped.code });
        throw mapped;
      }
    },
  };
}
