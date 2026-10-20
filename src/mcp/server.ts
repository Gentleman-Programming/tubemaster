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

type McpCore = VideoMetadataCoreSubset & PlaylistManagementCoreSubset & BestPublishTimesCoreSubset;

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
