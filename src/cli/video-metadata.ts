#!/usr/bin/env node

import { loadEnvConfig } from "@next/env";
import { fileURLToPath } from "node:url";
import type { DeviceAuthorizationStart } from "@/lib/auth";
import { createVideoMetadataCore } from "@/lib/video-metadata";
import { DomainError } from "@/lib/video-metadata/contracts";
import type { VideoMetadataCore } from "@/lib/video-metadata";
import { createPlaylistManagementCore, type PlaylistManagementCore } from "@/lib/playlist-management";
import { createMultiVideoUploadCore } from "@/lib/video-upload";
import { createMultiUploadAdapter } from "@/lib/video-upload/multi-adapter";
import { createVideoRecoveryCore } from "@/lib/video-recovery";
import { createCliAuthService } from "@/lib/cli-auth/service";
import type { CredentialRef } from "@/lib/video-metadata/contracts";
import {
  createBestPublishTimes,
  type BestPublishTimesError,
} from "@/lib/youtube-best-publish-times";

loadEnvConfig(process.cwd());

type CliAuthAdapter = {
  login(args?: { timeoutMs?: number }): Promise<unknown>;
  loginDevice(args?: { onPending?: (data: DeviceAuthorizationStart) => void }): Promise<unknown>;
  whoami(): Promise<unknown>;
  listKnownWriteChannels(args?: { credentialRef?: CredentialRef }): Promise<unknown>;
  selectWriteChannel(args: { channelId: string; credentialRef?: CredentialRef }): Promise<unknown>;
  listUsers(): Promise<unknown>;
  selectUser(args: { userId: string }): Promise<unknown>;
  logout(): Promise<unknown>;
  revoke(args?: { userId?: string }): Promise<unknown>;
  resolveEffectiveCredentialRef(args: { explicit?: CredentialRef }): Promise<CredentialRef>;
};

export type ParsedArgs = {
  namespace: "metadata" | "auth" | "playlist" | "upload";
  command:
    | "list"
    | "transcript"
    | "preview"
    | "apply"
    | "best-times"
    | "create"
    | "update"
    | "delete"
    | "add"
    | "remove"
    | "multi"
    | "reconcile"
    | "reconcile-many"
    | "cancel"
    | "login"
    | "whoami"
    | "list-channels"
    | "select-channel"
    | "list-users"
    | "select-user"
    | "logout"
    | "revoke";
  flags: Record<string, string | boolean>;
};

export function parseArgs(argv: string[]): ParsedArgs {
  const [namespaceRaw, maybeCommandRaw, ...remaining] = argv;
  const isAuthNamespace = namespaceRaw === "auth";
  const isPlaylistNamespace = namespaceRaw === "playlist";
  const isUploadNamespace = namespaceRaw === "upload";
  const commandRaw =
    isAuthNamespace || isPlaylistNamespace || isUploadNamespace ? maybeCommandRaw : namespaceRaw;
  const flagTokens =
    isAuthNamespace || isPlaylistNamespace || isUploadNamespace
      ? remaining
      : [maybeCommandRaw, ...remaining].filter(Boolean);

  const validMetadataCommands = ["list", "transcript", "preview", "apply", "best-times"];
  const validAuthCommands = ["login", "whoami", "list-channels", "select-channel", "list-users", "select-user", "logout", "revoke"];
  const validPlaylistCommands = ["list", "create", "update", "delete", "add", "remove"];
  const validUploadCommands = ["multi", "reconcile", "reconcile-many", "cancel"];
  const validCommands = isAuthNamespace
    ? validAuthCommands
    : isPlaylistNamespace
      ? validPlaylistCommands
      : isUploadNamespace
        ? validUploadCommands
        : validMetadataCommands;

  if (!commandRaw || !validCommands.includes(commandRaw)) {
    throw new DomainError({
      code: "validation_failed",
      message: isAuthNamespace
        ? "Auth command must be one of: login, whoami, list-channels, select-channel, list-users, select-user, logout, revoke"
        : isPlaylistNamespace
          ? "Playlist command must be one of: list, create, update, delete, add, remove"
          : isUploadNamespace
            ? "Upload command must be one of: multi, reconcile, reconcile-many, cancel"
            : "Command must be one of: list, transcript, preview, apply, best-times",
    });
  }

  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < flagTokens.length; i += 1) {
    const token = flagTokens[i];
    if (!token.startsWith("--")) {
      throw new DomainError({
        code: "validation_failed",
        message: `Invalid argument token: ${token}`,
      });
    }

    const key = token.slice(2);
    const nextValue = flagTokens[i + 1];

    if (!nextValue || nextValue.startsWith("--")) {
      flags[key] = true;
      continue;
    }

    flags[key] = nextValue;
    i += 1;
  }

  return {
    namespace: isAuthNamespace ? "auth" : isPlaylistNamespace ? "playlist" : isUploadNamespace ? "upload" : "metadata",
    command: commandRaw as ParsedArgs["command"],
    flags,
  };
}

function requirePlaylistMutationConfirmation(flags: Record<string, string | boolean>): void {
  if (flags.confirmed === true) return;
  throw new DomainError({
    code: "validation_failed",
    message: "confirmed" in flags
      ? "--confirmed must be provided without a value"
      : "Missing required --confirmed",
  });
}

function requireUploadConfirmation(flags: Record<string, string | boolean>): void {
  if (flags.confirmed === true) return;
  throw new DomainError({
    code: "validation_failed",
    message: "confirmed" in flags
      ? "--confirmed must be provided without a value"
      : "Missing required --confirmed",
  });
}

function parseJsonFlag(flags: Record<string, string | boolean>, key: string): unknown {
  const raw = requiredStringFlag(flags, key);
  try {
    return JSON.parse(raw);
  } catch {
    throw new DomainError({ code: "validation_failed", message: `Invalid JSON for --${key}` });
  }
}

function userIdFromCredentialRef(credentialRef: CredentialRef): string {
  if ("userId" in credentialRef && credentialRef.userId.trim()) return credentialRef.userId;
  throw new DomainError({ code: "validation_failed", message: "Upload commands require a user-scoped credentialRef" });
}

function parseVideoIdsFlag(flags: Record<string, string | boolean>) {
  const rawVideoIds = requiredStringFlag(flags, "videoIds");
  const ids = rawVideoIds
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (ids.length === 0) {
    throw new DomainError({
      code: "validation_failed",
      message: "Missing required --videoIds",
    });
  }

  return ids;
}

export function getCredentialRef(flags: Record<string, string | boolean>): CredentialRef | null {
  const userId = flags.userId;
  const accessToken = flags.accessToken;

  if (typeof userId === "string" && userId.length > 0) {
    return { userId };
  }

  if (typeof accessToken === "string" && accessToken.length > 0) {
    return {
      accessToken,
      refreshToken:
        typeof flags.refreshToken === "string" ? flags.refreshToken : undefined,
      scope: typeof flags.scope === "string" ? flags.scope : undefined,
      tokenExpiry:
        typeof flags.tokenExpiry === "string" ? Number(flags.tokenExpiry) : undefined,
    };
  }

  return null;
}

export function requiredStringFlag(
  flags: Record<string, string | boolean>,
  key: string
): string {
  const value = flags[key];
  if (typeof value === "string" && value.length > 0) return value;

  throw new DomainError({
    code: "validation_failed",
    message: `Missing required --${key}`,
  });
}

function serializeSuccess(data: unknown) {
  return JSON.stringify({ ok: true, data });
}

function serializeEvent(event: string, data: unknown) {
  return JSON.stringify({ ok: true, event, data });
}

function serializeBestPublishTimesError(error: BestPublishTimesError) {
  return JSON.stringify({
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      details: error.requiredScopes ? { requiredScopes: error.requiredScopes } : undefined,
    },
  });
}

type CliUploadCore = {
  multiUpload(userId: string, input: unknown): Promise<unknown>;
  reconcile(input: unknown): Promise<unknown>;
  reconcileMany(input: unknown): Promise<unknown>;
  cancel(input: unknown): Promise<unknown>;
};

function serializeError(error: unknown) {
  if (error instanceof DomainError) {
    return JSON.stringify({
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
  }

  return JSON.stringify({
    ok: false,
    error: {
      code: "internal_error",
      message: error instanceof Error ? error.message : "Unknown error",
    },
  });
}

export async function runCliCommand(args: {
  argv: string[];
  core?: Pick<
    VideoMetadataCore & PlaylistManagementCore,
    "listVideos" | "getTranscript" | "previewMetadata" | "applyMetadata"
    | "listPlaylists"
    | "createPlaylist"
    | "updatePlaylist"
    | "deletePlaylist"
    | "addVideosToPlaylist"
    | "removeVideosFromPlaylist"
  > &
    Partial<Pick<ReturnType<typeof createBestPublishTimes>, "fetchBestPublishTimes">> &
    Partial<CliUploadCore>;
  auth?: CliAuthAdapter;
  writeStdout?: (line: string) => void;
  writeStderr?: (line: string) => void;
}): Promise<number> {
  const core = args.core ?? {
    ...createVideoMetadataCore(),
    ...createPlaylistManagementCore(),
    ...createBestPublishTimes(),
  };
  const multiUpload = core.multiUpload ?? createMultiUploadAdapter({
    upload: async (_userId, input) => createMultiVideoUploadCore()(input),
    stagingRoot: process.env.VIDEO_UPLOAD_STAGING_ROOT ?? `${process.cwd()}/staging`,
    maxBytes: Number(process.env.VIDEO_UPLOAD_MAX_BYTES ?? 2 * 1024 * 1024 * 1024),
  });
  const reconcile = core.reconcile ?? ((input: unknown) => createVideoRecoveryCore().reconcile(input));
  const reconcileMany = core.reconcileMany ?? ((input: unknown) => createVideoRecoveryCore().reconcileMany(input));
  const cancel = core.cancel ?? ((input: unknown) => createVideoRecoveryCore().cancel(input));
  const auth = args.auth ?? createCliAuthService();
  const writeStdout =
    args.writeStdout ?? ((line: string) => process.stdout.write(`${line}\n`));
  const writeStderr =
    args.writeStderr ?? ((line: string) => process.stderr.write(`${line}\n`));

  try {
    const parsedArgs = parseArgs(args.argv);

    if (parsedArgs.namespace === "auth") {
      if (parsedArgs.command === "login") {
        const result =
          parsedArgs.flags.device === true
            ? await auth.loginDevice({
                onPending: (data) => writeStderr(serializeEvent("auth_pending", data)),
              })
            : await auth.login();
        writeStdout(serializeSuccess(result));
        return 0;
      }

      if (parsedArgs.command === "whoami") {
        const result = await auth.whoami();
        writeStdout(serializeSuccess(result));
        return 0;
      }

      if (parsedArgs.command === "list-channels") {
        const credentialRef = getCredentialRef(parsedArgs.flags) ?? undefined;
        const result = await auth.listKnownWriteChannels({ credentialRef });
        writeStdout(serializeSuccess(result));
        return 0;
      }

      if (parsedArgs.command === "select-channel") {
        const credentialRef = getCredentialRef(parsedArgs.flags) ?? undefined;
        const channelId =
          typeof parsedArgs.flags.channelId === "string" ? parsedArgs.flags.channelId : "";
        const result = await auth.selectWriteChannel({ channelId, credentialRef });
        writeStdout(serializeSuccess(result));
        return 0;
      }

      if (parsedArgs.command === "list-users") {
        const result = await auth.listUsers();
        writeStdout(serializeSuccess(result));
        return 0;
      }

      if (parsedArgs.command === "select-user") {
        const result = await auth.selectUser({
          userId: requiredStringFlag(parsedArgs.flags, "userId"),
        });
        writeStdout(serializeSuccess(result));
        return 0;
      }

      if (parsedArgs.command === "logout") {
        const result = await auth.logout();
        writeStdout(serializeSuccess(result));
        return 0;
      }

      const revokeUserId =
        typeof parsedArgs.flags.userId === "string" ? parsedArgs.flags.userId : undefined;
      const result = await auth.revoke({ userId: revokeUserId });
      writeStdout(serializeSuccess(result));
      return 0;
    }

    const explicitCredentialRef = getCredentialRef(parsedArgs.flags);
    const publicTranscript = parsedArgs.namespace === "metadata" && parsedArgs.command === "transcript" &&
      (parsedArgs.flags.provider ?? process.env.YOUTUBE_TRANSCRIPT_PROVIDER) === "yt-dlp";
    const credentialRef = (publicTranscript ? explicitCredentialRef : await auth.resolveEffectiveCredentialRef({
      explicit: explicitCredentialRef ?? undefined,
    })) as CredentialRef;

    if (parsedArgs.namespace === "upload") {
      const expectedChannelId = requiredStringFlag(parsedArgs.flags, "expectedChannelId");
      const userId = userIdFromCredentialRef(credentialRef);

      if (parsedArgs.command === "multi") {
        const dryRun = parsedArgs.flags.dryRun === true;
        if (!dryRun) requireUploadConfirmation(parsedArgs.flags);
        const input = {
          expectedChannelId,
          items: parseJsonFlag(parsedArgs.flags, "items"),
          ...(dryRun ? { dryRun: true } : {}),
          ...(parsedArgs.flags.confirmed === true ? { confirmed: true } : {}),
          ...(typeof parsedArgs.flags.confirmationToken === "string" ? { confirmationToken: parsedArgs.flags.confirmationToken } : {}),
        };
        const result = await multiUpload(userId, input);
        writeStdout(serializeSuccess(result));
        return 0;
      }

      if (parsedArgs.command === "reconcile") {
        const result = await reconcile({
          credentialRef,
          expectedChannelId,
          operationId: requiredStringFlag(parsedArgs.flags, "operationId"),
          ...(typeof parsedArgs.flags.videoId === "string" ? { videoId: parsedArgs.flags.videoId } : {}),
        });
        writeStdout(serializeSuccess(result));
        return 0;
      }

      if (parsedArgs.command === "reconcile-many") {
        const result = await reconcileMany({
          credentialRef,
          expectedChannelId,
          items: parseJsonFlag(parsedArgs.flags, "items"),
        });
        writeStdout(serializeSuccess(result));
        return 0;
      }

      const dryRun = parsedArgs.flags.dryRun === true;
      if (!dryRun) requireUploadConfirmation(parsedArgs.flags);
      const result = await cancel({
        credentialRef,
        expectedChannelId,
        operationId: requiredStringFlag(parsedArgs.flags, "operationId"),
        videoId: requiredStringFlag(parsedArgs.flags, "videoId"),
        dryRun,
        ...(parsedArgs.flags.confirmed === true ? { confirmed: true } : {}),
        ...(typeof parsedArgs.flags.confirmationToken === "string" ? { confirmationToken: parsedArgs.flags.confirmationToken } : {}),
      });
      writeStdout(serializeSuccess(result));
      return 0;
    }

    if (parsedArgs.namespace === "playlist") {
      if (parsedArgs.command === "list") {
        const result = await core.listPlaylists({ credentialRef });
        writeStdout(serializeSuccess(result));
        return 0;
      }

      requirePlaylistMutationConfirmation(parsedArgs.flags);
      const expectedChannelId = requiredStringFlag(parsedArgs.flags, "expectedChannelId");

      if (parsedArgs.command === "create") {
        const result = await core.createPlaylist({
          credentialRef,
          title: requiredStringFlag(parsedArgs.flags, "title"),
          expectedChannelId,
          description:
            typeof parsedArgs.flags.description === "string"
              ? parsedArgs.flags.description
              : undefined,
          privacyStatus:
            typeof parsedArgs.flags.privacyStatus === "string"
              ? parsedArgs.flags.privacyStatus
              : undefined,
        });
        writeStdout(serializeSuccess(result));
        return 0;
      }

      if (parsedArgs.command === "update") {
        const title = typeof parsedArgs.flags.title === "string" ? parsedArgs.flags.title : undefined;
        const description =
          typeof parsedArgs.flags.description === "string"
            ? parsedArgs.flags.description
            : undefined;
        const privacyStatus =
          typeof parsedArgs.flags.privacyStatus === "string"
            ? parsedArgs.flags.privacyStatus
            : undefined;

        if (title === undefined && description === undefined && privacyStatus === undefined) {
          throw new DomainError({
            code: "validation_failed",
            message: "At least one mutable field is required: title, description or privacyStatus",
          });
        }

        const result = await core.updatePlaylist({
          credentialRef,
          playlistId: requiredStringFlag(parsedArgs.flags, "playlistId"),
          expectedChannelId,
          title,
          description,
          privacyStatus,
        });
        writeStdout(serializeSuccess(result));
        return 0;
      }

      if (parsedArgs.command === "delete") {
        const result = await core.deletePlaylist({
          credentialRef,
          playlistId: requiredStringFlag(parsedArgs.flags, "playlistId"),
          expectedChannelId,
        });
        writeStdout(serializeSuccess(result));
        return 0;
      }

      if (parsedArgs.command === "add") {
        const result = await core.addVideosToPlaylist({
          credentialRef,
          playlistId: requiredStringFlag(parsedArgs.flags, "playlistId"),
          expectedChannelId,
          videoIds: parseVideoIdsFlag(parsedArgs.flags),
        });
        writeStdout(serializeSuccess(result));
        return 0;
      }

      const result = await core.removeVideosFromPlaylist({
        credentialRef,
        playlistId: requiredStringFlag(parsedArgs.flags, "playlistId"),
        expectedChannelId,
        videoIds: parseVideoIdsFlag(parsedArgs.flags),
      });
      writeStdout(serializeSuccess(result));
      return 0;
    }

    if (parsedArgs.command === "list") {
      const maxResults =
        typeof parsedArgs.flags.maxResults === "string"
          ? Number(parsedArgs.flags.maxResults)
          : undefined;
      const channelId =
        typeof parsedArgs.flags.channelId === "string" ? parsedArgs.flags.channelId : undefined;

      const result = await core.listVideos({
        credentialRef,
        ...(channelId ? { channelId } : {}),
        maxResults,
      });

      writeStdout(serializeSuccess(result));
      return 0;
    }

    if (parsedArgs.command === "transcript") {
      const result = await core.getTranscript({
        ...(!publicTranscript ? { credentialRef } : {}),
        videoId: requiredStringFlag(parsedArgs.flags, "videoId"),
        ...(parsedArgs.flags.provider !== undefined ? { provider: requiredStringFlag(parsedArgs.flags, "provider") } : {}),
      });

      writeStdout(serializeSuccess(result));
      return 0;
    }

    if (parsedArgs.command === "best-times") {
      const fetchBestPublishTimes =
        core.fetchBestPublishTimes ?? createBestPublishTimes().fetchBestPublishTimes;
      const result = await fetchBestPublishTimes({
        credentialRef,
        timezone: requiredStringFlag(parsedArgs.flags, "timezone"),
      });

      if (result.kind === "best-publish-times-error") {
        writeStderr(serializeBestPublishTimesError(result));
        return 1;
      }

      writeStdout(serializeSuccess(result));
      return 0;
    }

    if (parsedArgs.command === "preview") {
      const result = await core.previewMetadata({
        credentialRef,
        videoId: requiredStringFlag(parsedArgs.flags, "videoId"),
        editorialPrompt: requiredStringFlag(parsedArgs.flags, "editorialPrompt"),
      });

      writeStdout(serializeSuccess(result));
      return 0;
    }

    const result = await core.applyMetadata({
      credentialRef,
      videoId: requiredStringFlag(parsedArgs.flags, "videoId"),
      finalTitle: requiredStringFlag(parsedArgs.flags, "finalTitle"),
      description: requiredStringFlag(parsedArgs.flags, "description"),
      expectedChannelId: requiredStringFlag(parsedArgs.flags, "expectedChannelId"),
      dryRun: parsedArgs.flags.dryRun === true,
    });

    writeStdout(serializeSuccess(result));
    return 0;
  } catch (error) {
    writeStderr(serializeError(error));
    return 1;
  }
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  runCliCommand({ argv: process.argv.slice(2) })
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(`${serializeError(error)}\n`);
      process.exitCode = 1;
    });
}
