#!/usr/bin/env node

import { loadEnvConfig } from "@next/env";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createVideoMetadataCore } from "@/lib/video-metadata";
import { DomainError } from "@/lib/video-metadata/contracts";
import type { VideoMetadataCore } from "@/lib/video-metadata";
import { createCliAuthService, type CliAuthService } from "@/lib/cli-auth/service";
import type { CredentialRef } from "@/lib/video-metadata/contracts";
import { createPlaylistManagementCore, type PlaylistManagementCore } from "@/lib/playlist-management";
import {
  playlistAddVideosInputSchema,
  playlistCreateInputSchema,
  playlistDeleteInputSchema,
  playlistListInputSchema,
  playlistRemoveVideosInputSchema,
} from "@/lib/playlist-management/schemas";
import {
  createBestPublishTimes,
  type BestPublishTimesError,
} from "@/lib/youtube-best-publish-times";
import {
  SOCIAL_PLATFORMS,
  SOCIAL_POST_STATUSES,
  type SocialAccount,
  type SocialPlatform,
} from "@/lib/social/contracts";
import type { QueueErrorCode, QueueResult, SocialQueueService } from "@/lib/social/queue/service";
import type { StagedLocalFile } from "@/lib/social/queue/stage-local-file";
import { createMultiVideoUploadCore } from "@/lib/video-upload";
import { createMultiUploadAdapter } from "@/lib/video-upload/multi-adapter";
import { createVideoRecoveryCore } from "@/lib/video-recovery";

loadEnvConfig(process.cwd());

type VideoMetadataCoreSubset = Pick<
  VideoMetadataCore,
  "listVideos" | "getTranscript" | "previewMetadata" | "applyMetadata"
>;

type PlaylistManagementCoreSubset = Pick<
  PlaylistManagementCore,
  | "listPlaylists"
  | "createPlaylist"
  | "updatePlaylist"
  | "deletePlaylist"
  | "addVideosToPlaylist"
  | "removeVideosFromPlaylist"
>;

type BestPublishTimesCoreSubset = Partial<
  Pick<ReturnType<typeof createBestPublishTimes>, "fetchBestPublishTimes">
>;

type UploadMcpCore = {
  multiUpload: (userId: string, input: unknown) => Promise<unknown>;
  reconcile: (input: unknown) => Promise<unknown>;
  reconcileMany: (input: unknown) => Promise<unknown>;
  cancel: (input: unknown) => Promise<unknown>;
};

/** Social publishing (S12). The default implementation loads the social modules only when a tool runs. */
export type SocialMcpCore = {
  configuredPlatforms: () => SocialPlatform[];
  listAccounts: (userId: string) => Promise<SocialAccount[]>;
  stageLocalFile: (path: string) => Promise<StagedLocalFile>;
  queue: () => Promise<Pick<SocialQueueService, "preview" | "confirm" | "reschedule" | "cancel" | "list">>;
};

type McpCore = VideoMetadataCoreSubset &
  PlaylistManagementCoreSubset &
  BestPublishTimesCoreSubset & { social?: SocialMcpCore; upload?: UploadMcpCore };

const DEFAULT_VIDEO_UPLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024;

function stagingRoot() {
  return process.env.VIDEO_UPLOAD_STAGING_ROOT ?? `${process.cwd()}/staging`;
}

export const defaultSocialCore: SocialMcpCore = {
  // Same rule as the worker's publishers: a platform is usable only with both app credentials.
  configuredPlatforms: () =>
    SOCIAL_PLATFORMS.filter((platform) =>
      platform === "tiktok"
        ? Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET)
        : Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET)
    ),
  listAccounts: async (userId) => {
    const [{ quotaClient }, { createSocialStorage }] = await Promise.all([
      import("@/lib/db"),
      import("@/lib/social/storage"),
    ]);
    return createSocialStorage({ client: quotaClient, secret: process.env.NEXTAUTH_SECRET ?? "" }).listAccounts(userId);
  },
  stageLocalFile: async (path) => {
    const { stageLocalFile } = await import("@/lib/social/queue/stage-local-file");
    return stageLocalFile({
      path,
      stagingRoot: stagingRoot(),
      maxBytes: Number(process.env.VIDEO_UPLOAD_MAX_BYTES ?? DEFAULT_VIDEO_UPLOAD_MAX_BYTES),
    });
  },
  queue: async () => (await import("@/lib/social/queue")).createSocialQueue(),
};

const SOCIAL_ERROR_CODES = new Set<QueueErrorCode>([
  "INVALID_INPUT",
  "ACCOUNT_NOT_CONNECTED",
  "STAGED_VIDEO_INVALID",
  "NOT_FOUND",
  "INVALID_STATE",
  "CONFIRMATION_INVALID",
  "CONFIRMATION_EXPIRED",
]);

type ToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function toolErrorResult(error: unknown) {
  if (error instanceof DomainError) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            ok: false,
            error: {
              code: error.code,
              message: error.message,
              details: error.details,
            },
          }),
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          ok: false,
          error: {
            code: "internal_error",
            message: error instanceof Error ? error.message : "Unknown error",
          },
        }),
      },
    ],
    isError: true,
  };
}

function bestPublishTimesErrorResult(error: BestPublishTimesError): ToolResponse {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            details: error.requiredScopes ? { requiredScopes: error.requiredScopes } : undefined,
          },
        }),
      },
    ],
    isError: true,
  };
}

function socialErrorResult(error: { code: QueueErrorCode; message: string }): ToolResponse {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ ok: false, error: { code: error.code, message: error.message } }),
      },
    ],
    isError: true,
  };
}

/** Typed social failures (queue codes, e.g. a rejected local file) keep their code; anything else is internal. */
function socialThrownErrorResult(error: unknown): ToolResponse {
  const code = error instanceof Error ? (error as { code?: unknown }).code : undefined;
  if (typeof code === "string" && SOCIAL_ERROR_CODES.has(code as QueueErrorCode)) {
    return socialErrorResult({ code: code as QueueErrorCode, message: (error as Error).message });
  }
  return toolErrorResult(error);
}

/** Explicit allow-list so tokens or future storage fields never reach the MCP client. */
function toPublicSocialAccount(account: SocialAccount) {
  const { id, platform, externalAccountId, displayName, scopes, tokenExpiresAt, connectedAt } = account;
  return { id, platform, externalAccountId, displayName, scopes, tokenExpiresAt, connectedAt };
}

function toolSuccessResult(payload: Record<string, unknown>): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function mapValidationErrorResult(error: z.ZodError): ToolResponse {
  return toolErrorResult(
    new DomainError({
      code: "validation_failed",
      message: "Invalid MCP tool input",
      details: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
        code: issue.code,
      })),
    })
  );
}

export const credentialSchema = z.union([
  z.object({ userId: z.string().min(1) }).strict(),
  z
    .object({
      accessToken: z.string().min(1),
      refreshToken: z.string().optional(),
      tokenExpiry: z.number().int().positive().optional(),
      scope: z.string().optional(),
    })
    .strict(),
]);

export const listInputSchema = z
  .object({
    credentialRef: credentialSchema.optional(),
    channelId: z.string().min(1).optional(),
    maxResults: z.number().int().positive().max(50).optional(),
  })
  .strict();

export const transcriptInputSchema = z
  .object({
    credentialRef: credentialSchema.optional(),
    videoId: z.string().min(1),
  })
  .strict();

export const previewInputSchema = z
  .object({
    credentialRef: credentialSchema.optional(),
    videoId: z.string().min(1),
    editorialPrompt: z.string().min(1),
  })
  .strict();

export const applyInputSchema = z
  .object({
    credentialRef: credentialSchema.optional(),
    videoId: z.string().min(1),
    finalTitle: z.string().min(1),
    description: z.string().min(1),
    expectedChannelId: z.string().min(1),
    dryRun: z.boolean().optional(),
  })
  .strict();

export const bestPublishTimesInputSchema = z
  .object({
    credentialRef: credentialSchema.optional(),
    timezone: z.string().min(1),
  })
  .strict();

// Social tools act for a local user, so only the userId form of credentialRef is accepted.
const socialCredentialSchema = z.object({ userId: z.string().min(1) }).strict();

// Mirrors the queue's schedule schema; the queue still performs the detailed validation.
export const socialScheduleSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("now") }).strict(),
  z
    .object({
      mode: z.literal("at"),
      localDateTime: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/, "Use YYYY-MM-DDTHH:mm:ss local time"),
      timezone: z.string().min(1),
    })
    .strict(),
]);

export const socialAccountsInputSchema = z
  .object({ credentialRef: socialCredentialSchema.optional() })
  .strict();

export const socialStageVideoInputSchema = z
  .object({ path: z.string().min(1) })
  .strict();

export const socialPreviewInputSchema = z
  .object({
    credentialRef: socialCredentialSchema.optional(),
    platform: z.enum(SOCIAL_PLATFORMS),
    stagingFile: z.string().min(1),
    caption: z.string().trim().min(1).max(2200),
    platformOptions: z.record(z.string(), z.unknown()),
    schedule: socialScheduleSchema,
  })
  .strict();

export const socialConfirmInputSchema = z
  .object({
    credentialRef: socialCredentialSchema.optional(),
    postId: z.string().min(1),
    confirmationToken: z.string().min(1),
  })
  .strict();

export const socialQueueInputSchema = z
  .object({
    credentialRef: socialCredentialSchema.optional(),
    status: z.enum(SOCIAL_POST_STATUSES).optional(),
  })
  .strict();

export const socialCancelInputSchema = z
  .object({
    credentialRef: socialCredentialSchema.optional(),
    postId: z.string().min(1),
  })
  .strict();

export const socialRescheduleInputSchema = z
  .object({
    credentialRef: socialCredentialSchema.optional(),
    postId: z.string().min(1),
    schedule: socialScheduleSchema,
  })
  .strict();

export const writeChannelListInputSchema = z
  .object({
    credentialRef: credentialSchema.optional(),
  })
  .strict();

export const writeChannelSelectInputSchema = z
  .object({
    credentialRef: credentialSchema.optional(),
    channelId: z.string().min(1),
  })
  .strict();

export const authUserSelectInputSchema = z
  .object({
    userId: z.string().min(1),
  })
  .strict();

export const uploadMultiInputSchema = z.object({
  credentialRef: credentialSchema.optional(),
  expectedChannelId: z.string().min(1),
  items: z.array(z.object({
    stagingFile: z.string().min(1),
    title: z.string().trim().min(1).max(100),
    description: z.string().max(5000).optional(),
    tags: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
    categoryId: z.string().regex(/^\d+$/).optional(),
    defaultLanguage: z.string().trim().min(1).max(35).optional(),
    defaultAudioLanguage: z.string().trim().min(1).max(35).optional(),
    license: z.enum(["youtube", "creativeCommon"]).optional(),
    selfDeclaredMadeForKids: z.boolean().optional(),
    containsSyntheticMedia: z.boolean().optional(),
  }).strict()).min(1).max(10),
  dryRun: z.boolean().optional(),
  confirmed: z.boolean().optional(),
  confirmationToken: z.string().optional(),
}).strict();

export const uploadReconcileInputSchema = z.object({
  credentialRef: credentialSchema.optional(),
  expectedChannelId: z.string().min(1),
  operationId: z.string().trim().min(1),
  videoId: z.string().trim().min(1).optional(),
}).strict();

export const uploadReconcileManyInputSchema = z.object({
  credentialRef: credentialSchema.optional(),
  expectedChannelId: z.string().min(1),
  items: z.array(z.object({ operationId: z.string().trim().min(1), videoId: z.string().trim().min(1).optional() }).strict()).min(1).max(10),
}).strict();

export const uploadCancelInputSchema = z.object({
  credentialRef: credentialSchema.optional(),
  expectedChannelId: z.string().min(1),
  operationId: z.string().trim().min(1),
  videoId: z.string().trim().min(1),
  dryRun: z.boolean(),
  confirmed: z.boolean().optional(),
  confirmationToken: z.string().optional(),
}).strict();

const playlistUpdateToolInputSchema = z
  .object({
    credentialRef: credentialSchema.optional(),
    playlistId: z.string().min(1),
    expectedChannelId: z.string().min(1),
    title: z.string().trim().min(1).optional(),
    description: z.string().optional(),
    privacyStatus: z.enum(["private", "public", "unlisted"]).optional(),
  })
  .strict()
  .refine(
    (payload) =>
      payload.title !== undefined ||
      payload.description !== undefined ||
      payload.privacyStatus !== undefined,
    {
      message: "At least one mutable field is required: title, description or privacyStatus",
      path: ["title"],
    }
  );

export function createMcpToolHandlers(
  core: McpCore,
  auth: {
    resolveEffectiveCredentialRef: CliAuthService["resolveEffectiveCredentialRef"];
    whoami: () => Promise<unknown>;
    selectUser: (args: { userId: string }) => Promise<unknown>;
    listKnownWriteChannels: (args?: { credentialRef?: CredentialRef }) => Promise<unknown>;
    selectWriteChannel: (args: { channelId: string; credentialRef?: CredentialRef }) => Promise<unknown>;
  } = createCliAuthService()
) {
  async function resolveCredentialRef(explicitCredentialRef: unknown) {
    return auth.resolveEffectiveCredentialRef({
      explicit: explicitCredentialRef as CredentialRef | undefined,
    });
  }

  async function resolveUploadUserId(explicitCredentialRef: unknown) {
    const credentialRef = await resolveCredentialRef(explicitCredentialRef);
    if (!("userId" in credentialRef) || !credentialRef.userId) {
      throw new DomainError({ code: "validation_failed", message: "Upload tools require a user-scoped credentialRef" });
    }
    return credentialRef.userId;
  }

  const social = core.social ?? defaultSocialCore;
  const upload: UploadMcpCore = core.upload ?? {
    multiUpload: createMultiUploadAdapter({
      upload: async (_userId, input) => createMultiVideoUploadCore()(input),
      stagingRoot: process.env.VIDEO_UPLOAD_STAGING_ROOT ?? `${process.cwd()}/staging`,
      maxBytes: Number(process.env.VIDEO_UPLOAD_MAX_BYTES ?? DEFAULT_VIDEO_UPLOAD_MAX_BYTES),
    }),
    reconcile: (input) => createVideoRecoveryCore().reconcile(input),
    reconcileMany: (input) => createVideoRecoveryCore().reconcileMany(input),
    cancel: (input) => createVideoRecoveryCore().cancel(input),
  };

  /** The social queue is keyed by the Google `sub`, the same id the active auth context stores. */
  async function resolveSocialUserId(explicitCredentialRef: { userId: string } | undefined) {
    const credentialRef = await resolveCredentialRef(explicitCredentialRef);
    if (!("userId" in credentialRef) || !credentialRef.userId) {
      throw new DomainError({
        code: "AUTH_USER_NOT_FOUND",
        message: "Social tools need a local user. Run `auth login` first.",
      });
    }
    return credentialRef.userId;
  }

  function queueResult<T>(result: QueueResult<T>, toPayload: (value: T) => Record<string, unknown>) {
    return result.ok ? toolSuccessResult(toPayload(result.value)) : socialErrorResult(result.error);
  }

  return {
    async writeContext(): Promise<ToolResponse> {
      try {
        const result = await auth.whoami();
        return toolSuccessResult(result as Record<string, unknown>);
      } catch (error) {
        return toolErrorResult(error);
      }
    },

    async writeChannelList(input: unknown): Promise<ToolResponse> {
      const parsedInput = writeChannelListInputSchema.safeParse(input);
      if (!parsedInput.success) {
        return mapValidationErrorResult(parsedInput.error);
      }

      try {
        const result = await auth.listKnownWriteChannels({
          credentialRef: parsedInput.data.credentialRef as CredentialRef | undefined,
        });
        return toolSuccessResult(result as Record<string, unknown>);
      } catch (error) {
        return toolErrorResult(error);
      }
    },

    async writeChannelSelect(input: unknown): Promise<ToolResponse> {
      const parsedInput = writeChannelSelectInputSchema.safeParse(input);
      if (!parsedInput.success) {
        return mapValidationErrorResult(parsedInput.error);
      }

      try {
        const result = await auth.selectWriteChannel({
          credentialRef: parsedInput.data.credentialRef as CredentialRef | undefined,
          channelId: parsedInput.data.channelId,
        });
        return toolSuccessResult(result as Record<string, unknown>);
      } catch (error) {
        return toolErrorResult(error);
      }
    },

    async whoami(): Promise<ToolResponse> {
      try {
        const result = await auth.whoami();
        return toolSuccessResult(result as Record<string, unknown>);
      } catch (error) {
        return toolErrorResult(error);
      }
    },

    async authUserSelect(input: unknown): Promise<ToolResponse> {
      const parsedInput = authUserSelectInputSchema.safeParse(input);
      if (!parsedInput.success) {
        return mapValidationErrorResult(parsedInput.error);
      }

      try {
        const result = await auth.selectUser({
          userId: parsedInput.data.userId,
        });
        return toolSuccessResult(result as Record<string, unknown>);
      } catch (error) {
        if (error instanceof DomainError && error.code === "AUTH_USER_NOT_FOUND") {
          return toolErrorResult(error);
        }

        return toolErrorResult(error);
      }
    },

    async list(input: unknown): Promise<ToolResponse> {
      const parsedInput = listInputSchema.safeParse(input);
      if (!parsedInput.success) {
        return mapValidationErrorResult(parsedInput.error);
      }

      try {
        const credentialRef = await resolveCredentialRef(parsedInput.data.credentialRef);
        const result = await core.listVideos({
          ...parsedInput.data,
          credentialRef,
        });
        return toolSuccessResult(result as Record<string, unknown>);
      } catch (error) {
        return toolErrorResult(error);
      }
    },

    async transcript(input: unknown): Promise<ToolResponse> {
      const parsedInput = transcriptInputSchema.safeParse(input);
      if (!parsedInput.success) {
        return mapValidationErrorResult(parsedInput.error);
      }

      try {
        const credentialRef = await resolveCredentialRef(parsedInput.data.credentialRef);
        const result = await core.getTranscript({
          ...parsedInput.data,
          credentialRef,
        });
        return toolSuccessResult(result as Record<string, unknown>);
      } catch (error) {
        return toolErrorResult(error);
      }
    },

    async preview(input: unknown): Promise<ToolResponse> {
      const parsedInput = previewInputSchema.safeParse(input);
      if (!parsedInput.success) {
        return mapValidationErrorResult(parsedInput.error);
      }

      try {
        const credentialRef = await resolveCredentialRef(parsedInput.data.credentialRef);
        const result = await core.previewMetadata({
          ...parsedInput.data,
          credentialRef,
        });
        return toolSuccessResult(result as Record<string, unknown>);
      } catch (error) {
        return toolErrorResult(error);
      }
    },

    async apply(input: unknown): Promise<ToolResponse> {
      const parsedInput = applyInputSchema.safeParse(input);
      if (!parsedInput.success) {
        return mapValidationErrorResult(parsedInput.error);
      }

      try {
        const credentialRef = await resolveCredentialRef(parsedInput.data.credentialRef);
        const result = await core.applyMetadata({
          ...parsedInput.data,
          credentialRef,
        });
        return toolSuccessResult(result as Record<string, unknown>);
      } catch (error) {
        return toolErrorResult(error);
      }
    },

    async bestPublishTimes(input: unknown): Promise<ToolResponse> {
      const parsedInput = bestPublishTimesInputSchema.safeParse(input);
      if (!parsedInput.success) {
        return mapValidationErrorResult(parsedInput.error);
      }

      try {
        const credentialRef = await resolveCredentialRef(parsedInput.data.credentialRef);
        const fetchBestPublishTimes =
          core.fetchBestPublishTimes ?? createBestPublishTimes().fetchBestPublishTimes;
        const result = await fetchBestPublishTimes({
          credentialRef,
          timezone: parsedInput.data.timezone,
        });
        if (result.kind === "best-publish-times-error") {
          return bestPublishTimesErrorResult(result);
        }
        return toolSuccessResult(result);
      } catch (error) {
        return toolErrorResult(error);
      }
    },

    async uploadMulti(input: unknown): Promise<ToolResponse> {
      const parsedInput = uploadMultiInputSchema.safeParse(input);
      if (!parsedInput.success) return mapValidationErrorResult(parsedInput.error);
      try {
        const { credentialRef, ...payload } = parsedInput.data;
        const userId = await resolveUploadUserId(credentialRef);
        return toolSuccessResult(await upload.multiUpload(userId, payload) as Record<string, unknown>);
      } catch (error) {
        return toolErrorResult(error);
      }
    },

    async uploadReconcile(input: unknown): Promise<ToolResponse> {
      const parsedInput = uploadReconcileInputSchema.safeParse(input);
      if (!parsedInput.success) return mapValidationErrorResult(parsedInput.error);
      try {
        const credentialRef = await resolveCredentialRef(parsedInput.data.credentialRef);
        return toolSuccessResult(await upload.reconcile({ ...parsedInput.data, credentialRef }) as Record<string, unknown>);
      } catch (error) {
        return toolErrorResult(error);
      }
    },

    async uploadReconcileMany(input: unknown): Promise<ToolResponse> {
      const parsedInput = uploadReconcileManyInputSchema.safeParse(input);
      if (!parsedInput.success) return mapValidationErrorResult(parsedInput.error);
      try {
        const credentialRef = await resolveCredentialRef(parsedInput.data.credentialRef);
        return toolSuccessResult(await upload.reconcileMany({ ...parsedInput.data, credentialRef }) as Record<string, unknown>);
      } catch (error) {
        return toolErrorResult(error);
      }
    },

    async uploadCancel(input: unknown): Promise<ToolResponse> {
      const parsedInput = uploadCancelInputSchema.safeParse(input);
      if (!parsedInput.success) return mapValidationErrorResult(parsedInput.error);
      try {
        const credentialRef = await resolveCredentialRef(parsedInput.data.credentialRef);
        return toolSuccessResult(await upload.cancel({ ...parsedInput.data, credentialRef }) as Record<string, unknown>);
      } catch (error) {
        return toolErrorResult(error);
      }
    },

    async socialAccounts(input: unknown): Promise<ToolResponse> {
      const parsedInput = socialAccountsInputSchema.safeParse(input);
      if (!parsedInput.success) {
        return mapValidationErrorResult(parsedInput.error);
      }

      try {
        const userId = await resolveSocialUserId(parsedInput.data.credentialRef);
        const accounts = await social.listAccounts(userId);
        return toolSuccessResult({
          accounts: accounts.map(toPublicSocialAccount),
          configuredPlatforms: social.configuredPlatforms(),
          connectHint: "Connect each platform once in the web app at /dashboard/social.",
        });
      } catch (error) {
        return socialThrownErrorResult(error);
      }
    },

    async socialStageVideo(input: unknown): Promise<ToolResponse> {
      const parsedInput = socialStageVideoInputSchema.safeParse(input);
      if (!parsedInput.success) {
        return mapValidationErrorResult(parsedInput.error);
      }

      try {
        const staged = await social.stageLocalFile(parsedInput.data.path);
        return toolSuccessResult({ stagingFile: staged.stagingFile, size: staged.size });
      } catch (error) {
        return socialThrownErrorResult(error);
      }
    },

    async socialPreview(input: unknown): Promise<ToolResponse> {
      const parsedInput = socialPreviewInputSchema.safeParse(input);
      if (!parsedInput.success) {
        return mapValidationErrorResult(parsedInput.error);
      }

      try {
        const { credentialRef, ...fields } = parsedInput.data;
        const userId = await resolveSocialUserId(credentialRef);
        const queue = await social.queue();
        const result = await queue.preview({
          userId,
          ...fields,
          platformOptions: fields.platformOptions as Parameters<typeof queue.preview>[0]["platformOptions"],
        });
        return queueResult(result, (preview) => ({
          ...preview,
          nextStep:
            "Nothing is scheduled yet. Show this preview to the human and call social_confirm only after they explicitly approve it.",
        }));
      } catch (error) {
        return socialThrownErrorResult(error);
      }
    },

    async socialConfirm(input: unknown): Promise<ToolResponse> {
      const parsedInput = socialConfirmInputSchema.safeParse(input);
      if (!parsedInput.success) {
        return mapValidationErrorResult(parsedInput.error);
      }

      try {
        const userId = await resolveSocialUserId(parsedInput.data.credentialRef);
        const queue = await social.queue();
        const result = await queue.confirm({
          userId,
          postId: parsedInput.data.postId,
          confirmationToken: parsedInput.data.confirmationToken,
        });
        return queueResult(result, (post) => ({ post }));
      } catch (error) {
        return socialThrownErrorResult(error);
      }
    },

    async socialQueue(input: unknown): Promise<ToolResponse> {
      const parsedInput = socialQueueInputSchema.safeParse(input);
      if (!parsedInput.success) {
        return mapValidationErrorResult(parsedInput.error);
      }

      try {
        const userId = await resolveSocialUserId(parsedInput.data.credentialRef);
        const queue = await social.queue();
        const result = await queue.list(
          parsedInput.data.status === undefined ? { userId } : { userId, status: parsedInput.data.status }
        );
        return queueResult(result, (posts) => ({ posts }));
      } catch (error) {
        return socialThrownErrorResult(error);
      }
    },

    async socialCancel(input: unknown): Promise<ToolResponse> {
      const parsedInput = socialCancelInputSchema.safeParse(input);
      if (!parsedInput.success) {
        return mapValidationErrorResult(parsedInput.error);
      }

      try {
        const userId = await resolveSocialUserId(parsedInput.data.credentialRef);
        const queue = await social.queue();
        const result = await queue.cancel({ userId, postId: parsedInput.data.postId });
        return queueResult(result, (post) => ({ post }));
      } catch (error) {
        return socialThrownErrorResult(error);
      }
    },

    async socialReschedule(input: unknown): Promise<ToolResponse> {
      const parsedInput = socialRescheduleInputSchema.safeParse(input);
      if (!parsedInput.success) {
        return mapValidationErrorResult(parsedInput.error);
      }

      try {
        const userId = await resolveSocialUserId(parsedInput.data.credentialRef);
        const queue = await social.queue();
        const result = await queue.reschedule({
          userId,
          postId: parsedInput.data.postId,
          schedule: parsedInput.data.schedule,
        });
        return queueResult(result, (preview) => ({
          ...preview,
          nextStep:
            "The post is back in draft. Show this preview to the human and call social_confirm only after they explicitly approve it.",
        }));
      } catch (error) {
        return socialThrownErrorResult(error);
      }
    },

    async playlistList(input: unknown): Promise<ToolResponse> {
      const parsedInput = playlistListInputSchema
        .partial({ credentialRef: true })
        .safeParse(input);
      if (!parsedInput.success) {
        return mapValidationErrorResult(parsedInput.error);
      }

      try {
        const credentialRef = await resolveCredentialRef(parsedInput.data.credentialRef);
        const result = await core.listPlaylists({ credentialRef });
        return toolSuccessResult(result as Record<string, unknown>);
      } catch (error) {
        return toolErrorResult(error);
      }
    },

    async playlistCreate(input: unknown): Promise<ToolResponse> {
      const parsedInput = playlistCreateInputSchema
        .partial({ credentialRef: true })
        .safeParse(input);
      if (!parsedInput.success) {
        return mapValidationErrorResult(parsedInput.error);
      }

      try {
        const credentialRef = await resolveCredentialRef(parsedInput.data.credentialRef);
        const result = await core.createPlaylist({
          ...parsedInput.data,
          credentialRef,
        });
        return toolSuccessResult(result as Record<string, unknown>);
      } catch (error) {
        return toolErrorResult(error);
      }
    },

    async playlistDelete(input: unknown): Promise<ToolResponse> {
      const parsedInput = playlistDeleteInputSchema
        .partial({ credentialRef: true })
        .safeParse(input);
      if (!parsedInput.success) {
        return mapValidationErrorResult(parsedInput.error);
      }

      try {
        const credentialRef = await resolveCredentialRef(parsedInput.data.credentialRef);
        const result = await core.deletePlaylist({
          ...parsedInput.data,
          credentialRef,
        });
        return toolSuccessResult(result as Record<string, unknown>);
      } catch (error) {
        return toolErrorResult(error);
      }
    },

    async playlistUpdate(input: unknown): Promise<ToolResponse> {
      const parsedInput = playlistUpdateToolInputSchema.safeParse(input);
      if (!parsedInput.success) {
        return mapValidationErrorResult(parsedInput.error);
      }

      try {
        const credentialRef = await resolveCredentialRef(parsedInput.data.credentialRef);
        const result = await core.updatePlaylist({
          ...parsedInput.data,
          credentialRef,
        });
        return toolSuccessResult(result as Record<string, unknown>);
      } catch (error) {
        return toolErrorResult(error);
      }
    },

    async playlistAddVideos(input: unknown): Promise<ToolResponse> {
      const parsedInput = playlistAddVideosInputSchema
        .partial({ credentialRef: true })
        .safeParse(input);
      if (!parsedInput.success) {
        return mapValidationErrorResult(parsedInput.error);
      }

      try {
        const credentialRef = await resolveCredentialRef(parsedInput.data.credentialRef);
        const result = await core.addVideosToPlaylist({
          ...parsedInput.data,
          credentialRef,
        });
        return toolSuccessResult(result as Record<string, unknown>);
      } catch (error) {
        return toolErrorResult(error);
      }
    },

    async playlistRemoveVideos(input: unknown): Promise<ToolResponse> {
      const parsedInput = playlistRemoveVideosInputSchema
        .partial({ credentialRef: true })
        .safeParse(input);
      if (!parsedInput.success) {
        return mapValidationErrorResult(parsedInput.error);
      }

      try {
        const credentialRef = await resolveCredentialRef(parsedInput.data.credentialRef);
        const result = await core.removeVideosFromPlaylist({
          ...parsedInput.data,
          credentialRef,
        });
        return toolSuccessResult(result as Record<string, unknown>);
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  };
}

export function createMcpServer(
  core: McpCore = {
    ...createVideoMetadataCore(),
    ...createPlaylistManagementCore(),
    ...createBestPublishTimes(),
  }
) {
  const server = new McpServer({
    name: "youtube-video-metadata",
    version: "0.1.0",
  });

  const handlers = createMcpToolHandlers(core);

  server.registerTool(
    "write_context",
    {
      description:
        "Read-only write context for current OAuth session, including activeWriteChannel, selectedChannelId and effectiveCredentialRef.",
      inputSchema: z.object({}).strict(),
    },
    () => handlers.writeContext()
  );

  server.registerTool(
    "write_channel_list",
    {
      description:
        "List the minimal-safe known write channels from local state (active OAuth + persisted selection).",
      inputSchema: writeChannelListInputSchema,
    },
    (args) => handlers.writeChannelList(args)
  );

  server.registerTool(
    "write_channel_select",
    {
      description:
        "Persist expected write channel selection and return alignment state. Does not switch active OAuth identity.",
      inputSchema: writeChannelSelectInputSchema,
    },
    (args) => handlers.writeChannelSelect(args)
  );

  server.registerTool(
    "whoami",
    {
      description:
        "Return the active local authenticated user for this MCP server. Use this when you need to confirm which YouTube account will be used before calling other tools.",
      inputSchema: z.object({}).strict(),
    },
    () => handlers.whoami()
  );

  server.registerTool(
    "auth_user_select",
    {
      description:
        "Switch local active user fallback. Does not login, reauth, or switch active OAuth channel.",
      inputSchema: authUserSelectInputSchema,
    },
    (args) => handlers.authUserSelect(args)
  );

  server.registerTool(
    "list",
    {
      description:
        "List channel videos using the shared core. credentialRef is OPTIONAL: if omitted, the server uses the active local auth context established via CLI auth login. channelId is OPTIONAL and recommended for multi-account / Brand Account setups to force a specific YouTube channel.",
      inputSchema: listInputSchema,
    },
    (args) => handlers.list(args)
  );

  server.registerTool(
    "transcript",
    {
      description:
        "Get transcript status and text for a video. credentialRef is OPTIONAL: if omitted, the server uses the active local auth context established via CLI auth login.",
      inputSchema: transcriptInputSchema,
    },
    (args) => handlers.transcript(args)
  );

  server.registerTool(
    "preview",
    {
      description:
        "Generate final title and description preview for a video. credentialRef is OPTIONAL: if omitted, the server uses the active local auth context established via CLI auth login.",
      inputSchema: previewInputSchema,
    },
    (args) => handlers.preview(args)
  );

  server.registerTool(
    "apply",
    {
      description:
        "Apply metadata with optional dryRun. credentialRef is OPTIONAL: if omitted, the server uses the active local auth context established via CLI auth login.",
      inputSchema: applyInputSchema,
    },
    (args) => handlers.apply(args)
  );

  server.registerTool(
    "best_publish_times",
    {
      description:
        "Read-only estimate of the best weekday/hour slots to publish, derived from the channel's own past uploads and their early views (not live audience data). Never publishes, uploads or schedules anything. timezone (IANA, e.g. America/Argentina/Buenos_Aires) is REQUIRED. Requires the yt-analytics.readonly scope. credentialRef is OPTIONAL and falls back to active local auth context.",
      inputSchema: bestPublishTimesInputSchema,
    },
    (args) => handlers.bestPublishTimes(args)
  );

  server.registerTool(
    "upload_multi",
    {
      description: "Preview or explicitly confirm a bounded multi-video private upload using staged files. dryRun returns the confirmation envelope; confirmed execution never publishes automatically. credentialRef is OPTIONAL and falls back to active local auth context.",
      inputSchema: uploadMultiInputSchema,
    },
    (args) => handlers.uploadMulti(args)
  );

  server.registerTool(
    "upload_reconcile",
    {
      description: "Reconcile one upload operation without retrying it. Returns success, absence, unsupported, or unknown status while preserving operationId and expectedChannelId.",
      inputSchema: uploadReconcileInputSchema,
    },
    (args) => handlers.uploadReconcile(args)
  );

  server.registerTool(
    "upload_reconcile_many",
    {
      description: "Reconcile ordered upload operations without retrying them; each result preserves its input index and operation identity.",
      inputSchema: uploadReconcileManyInputSchema,
    },
    (args) => handlers.uploadReconcileMany(args)
  );

  server.registerTool(
    "upload_cancel",
    {
      description: "Preview or explicitly confirm return-to-private recovery for a video. Provider capability, channel, quota and confirmation guards remain in the shared recovery core.",
      inputSchema: uploadCancelInputSchema,
    },
    (args) => handlers.uploadCancel(args)
  );

  server.registerTool(
    "social_accounts",
    {
      description:
        "List the connected Instagram/TikTok accounts (public fields only, never tokens) and which platforms have app credentials configured. Accounts are connected once in the web app at /dashboard/social, not through MCP. credentialRef is OPTIONAL and falls back to active local auth context.",
      inputSchema: socialAccountsInputSchema,
    },
    (args) => handlers.socialAccounts(args)
  );

  server.registerTool(
    "social_stage_video",
    {
      description:
        "Copy a local video (absolute path to a regular mp4/mov/webm/mkv file, no symlinks, within VIDEO_UPLOAD_MAX_BYTES) into the staging folder and return its stagingFile name. The source file is only read, never moved or modified. Does not publish anything.",
      inputSchema: socialStageVideoInputSchema,
    },
    (args) => handlers.socialStageVideo(args)
  );

  server.registerTool(
    "social_preview",
    {
      description:
        "Create a draft post for a staged video and return its preview plus a confirmationToken (valid 10 minutes). This does NOT publish or schedule anything. Show the preview (account, caption, platform options, scheduled time) to the human; confirming it requires their explicit human approval through social_confirm. schedule is {mode:'now'} or {mode:'at', localDateTime:'YYYY-MM-DDTHH:mm:ss', timezone:IANA}. TikTok needs platformOptions.privacyLevel (unaudited apps can only post SELF_ONLY); Instagram accepts platformOptions.shareToFeed. credentialRef is OPTIONAL and falls back to active local auth context.",
      inputSchema: socialPreviewInputSchema,
    },
    (args) => handlers.socialPreview(args)
  );

  server.registerTool(
    "social_confirm",
    {
      description:
        "Confirm a previewed post: it is scheduled and then published irreversibly at its time (or right away for mode 'now'). Call this ONLY after the human has explicitly approved the exact preview you showed them; never on your own initiative. The token is bound to the file bytes, account, caption, options and time, so any change requires a new preview. The web app must be running (npm run dev -- --experimental-https) for its worker to publish; a post more than 5 minutes late is marked missed, never published late. credentialRef is OPTIONAL and falls back to active local auth context.",
      inputSchema: socialConfirmInputSchema,
    },
    (args) => handlers.socialConfirm(args)
  );

  server.registerTool(
    "social_queue",
    {
      description:
        "List the user's social posts with their status (draft, scheduled, publishing, published, failed, missed, cancelled), optionally filtered by status. Read-only. credentialRef is OPTIONAL and falls back to active local auth context.",
      inputSchema: socialQueueInputSchema,
    },
    (args) => handlers.socialQueue(args)
  );

  server.registerTool(
    "social_cancel",
    {
      description:
        "Cancel a draft, scheduled, failed or missed social post so it is never published. credentialRef is OPTIONAL and falls back to active local auth context.",
      inputSchema: socialCancelInputSchema,
    },
    (args) => handlers.socialCancel(args)
  );

  server.registerTool(
    "social_reschedule",
    {
      description:
        "Move a scheduled, failed or missed social post to a new time. The post returns to draft and is NOT scheduled until the human explicitly approves the returned preview and social_confirm is called with the new confirmationToken. credentialRef is OPTIONAL and falls back to active local auth context.",
      inputSchema: socialRescheduleInputSchema,
    },
    (args) => handlers.socialReschedule(args)
  );

  server.registerTool(
    "playlist_list",
    {
      description:
        "List playlists for the authenticated YouTube account. credentialRef is OPTIONAL and falls back to active local auth context.",
      inputSchema: playlistListInputSchema.partial({ credentialRef: true }),
    },
    (args) => handlers.playlistList(args)
  );

  server.registerTool(
    "playlist_create",
    {
      description:
        "Create a YouTube playlist. credentialRef is OPTIONAL and falls back to active local auth context.",
      inputSchema: playlistCreateInputSchema.partial({ credentialRef: true }),
    },
    (args) => handlers.playlistCreate(args)
  );

  server.registerTool(
    "playlist_add_videos",
    {
      description:
        "Add one or more videos to a playlist and return stable partial results with attempted/added/failures.",
      inputSchema: playlistAddVideosInputSchema.partial({ credentialRef: true }),
    },
    (args) => handlers.playlistAddVideos(args)
  );

  server.registerTool(
    "playlist_delete",
    {
      description:
        "Delete a playlist after strict write-channel guardrail validation. credentialRef is OPTIONAL and falls back to active local auth context.",
      inputSchema: playlistDeleteInputSchema.partial({ credentialRef: true }),
    },
    (args) => handlers.playlistDelete(args)
  );

  server.registerTool(
    "playlist_update",
    {
      description:
        "Update playlist metadata with strict patch validation and write-channel guardrails. credentialRef is OPTIONAL and falls back to active local auth context.",
      inputSchema: playlistUpdateToolInputSchema,
    },
    (args) => handlers.playlistUpdate(args)
  );

  server.registerTool(
    "playlist_remove_videos",
    {
      description:
        "Remove one or more videos from a playlist and return stable partial results with requested/removed/failures.",
      inputSchema: playlistRemoveVideosInputSchema.partial({ credentialRef: true }),
    },
    (args) => handlers.playlistRemoveVideos(args)
  );

  return server;
}

export async function startMcpServer() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  startMcpServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
