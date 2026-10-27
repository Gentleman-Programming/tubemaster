import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "@/lib/video-metadata/contracts";
import type { VideoMetadataCore } from "@/lib/video-metadata";
import type { PlaylistManagementCore } from "@/lib/playlist-management";
import { createMcpServer, createMcpToolHandlers } from "./server";

function makeCoreStub(): Pick<
  VideoMetadataCore & PlaylistManagementCore,
  | "listVideos"
  | "getTranscript"
  | "previewMetadata"
  | "applyMetadata"
  | "listPlaylists"
  | "createPlaylist"
  | "updatePlaylist"
  | "deletePlaylist"
  | "addVideosToPlaylist"
  | "removeVideosFromPlaylist"
> {
  return {
    listVideos: async (input: unknown) => {
      void input;
      return { videos: [] };
    },
    getTranscript: async (input: unknown) => {
      void input;
      return { transcript: { status: "available" as const, text: "Transcript" } };
    },
    previewMetadata: async (input: unknown) => {
      void input;
      return {
        video: { videoId: "v1", title: "Video", description: "Desc", publishedAt: "2024-01-01" },
        transcript: { status: "available" as const, text: "Transcript" },
        draft: {
          finalTitle: "Final",
          description: "Description",
          promptVersion: "video-metadata-v1",
        },
      };
    },
    applyMetadata: async (input: unknown) => {
      void input;
      return {
        dryRun: true,
        videoId: "v1",
        targetLanguage: "es",
        languageSource: "defaultLanguage" as const,
        snippet: {
          before: { title: "Before", description: "Before desc", categoryId: "22" },
          proposed: { title: "After", description: "After desc", categoryId: "22" },
        },
        localizations: {
          before: {
            es: { title: "Antes", description: "Antes desc" },
            en: { title: "Before EN", description: "Before desc EN" },
          },
          proposed: {
            es: { title: "After", description: "After desc" },
            en: { title: "Before EN", description: "Before desc EN" },
          },
          affected: [
            {
              locale: "es",
              before: { title: "Antes", description: "Antes desc" },
              proposed: { title: "After", description: "After desc" },
              source: "defaultLanguage" as const,
            },
          ],
        },
      };
    },
    listPlaylists: async () => ({
      playlists: [
        {
          id: "p1",
          title: "Playlist 1",
          description: "Playlist description",
          privacyStatus: "private" as const,
        },
      ],
    }),
    createPlaylist: async (input: unknown) => {
      void input;
      return {
        playlist: {
          id: "p1",
          title: "Playlist 1",
          description: "Playlist description",
          privacyStatus: "private" as const,
        },
      };
    },
    updatePlaylist: async () => ({
      playlist: {
        id: "p1",
        title: "Playlist 1",
        description: "Playlist description",
        privacyStatus: "private" as const,
      },
    }),
    deletePlaylist: async () => ({ deleted: true, playlistId: "p1" }),
    addVideosToPlaylist: async () => ({
      playlistId: "p1",
      attempted: 2,
      added: 1,
      failures: [{ videoId: "v2", reason: "already-present" as const }],
    }),
    removeVideosFromPlaylist: async () => ({
      playlistId: "p1",
      requested: 2,
      removed: 1,
      failures: [{ videoId: "v2", reason: "not-found-in-playlist" as const }],
    }),
  };
}

function makeAuthStub() {
  return {
    whoami: async () => ({
      userId: "active-user",
      email: "active-user@example.com",
      name: null,
      tokenExpiry: null,
      hasRefreshToken: true,
      isActive: true,
      activeWriteChannel: { id: "UC_ACTIVE", title: "Active channel" },
      selectedChannelId: "UC_SELECTED",
      alignment: {
        status: "mismatch",
        requiresReauth: true,
        message: "Selected expected channel does not match the active OAuth channel.",
        recommendedAction: "Reauthenticate with the expected channel or select the active channel.",
      },
      requiresReauth: true,
      knownChannels: [
        {
          id: "UC_ACTIVE",
          title: "Active channel",
          source: "active",
          isActive: true,
          isSelected: false,
        },
        {
          id: "UC_SELECTED",
          title: null,
          source: "selected",
          isActive: false,
          isSelected: true,
        },
      ],
      writeChannel: {
        activeWriteChannel: { id: "UC_ACTIVE", title: "Active channel" },
        selectedChannelId: "UC_SELECTED",
        expectedChannelId: "UC_SELECTED",
        source: "stored",
        knownChannels: [
          {
            id: "UC_ACTIVE",
            title: "Active channel",
            source: "active",
            isActive: true,
            isSelected: false,
          },
          {
            id: "UC_SELECTED",
            title: null,
            source: "selected",
            isActive: false,
            isSelected: true,
          },
        ],
        alignment: {
          status: "mismatch",
          requiresReauth: true,
          message: "Selected expected channel does not match the active OAuth channel.",
          recommendedAction: "Reauthenticate with the expected channel or select the active channel.",
        },
        requiresReauth: true,
      },
      effectiveCredentialRef: { userId: "active-user" },
    }),
    selectUser: async ({ userId }: { userId: string }) => ({
      activeUser: {
        userId,
        email: `${userId}@example.com`,
        name: null,
        tokenExpiry: null,
        hasRefreshToken: true,
        isActive: true,
      },
      previousActiveUserId: "active-user",
      changed: userId !== "active-user",
      effectiveCredentialRef: { userId },
      writeChannel: {
        activeWriteChannel: { id: "UC_ACTIVE", title: "Active channel" },
        selectedChannelId: "UC_SELECTED",
        expectedChannelId: "UC_SELECTED",
        source: "stored",
        knownChannels: [],
        alignment: {
          status: "mismatch",
          requiresReauth: true,
          message: "Selected expected channel does not match the active OAuth channel.",
          recommendedAction: "Reauthenticate with the expected channel or select the active channel.",
        },
        requiresReauth: true,
      },
      activeWriteChannel: { id: "UC_ACTIVE", title: "Active channel" },
      selectedChannelId: "UC_SELECTED",
      alignment: {
        status: "mismatch",
        requiresReauth: true,
        message: "Selected expected channel does not match the active OAuth channel.",
        recommendedAction: "Reauthenticate with the expected channel or select the active channel.",
      },
      requiresReauth: true,
      affectsRemoteOAuth: false as const,
    }),
    listKnownWriteChannels: async () => ({
      knownChannels: [
        {
          id: "UC_ACTIVE",
          title: "Active channel",
          source: "active",
          isActive: true,
          isSelected: false,
        },
        {
          id: "UC_SELECTED",
          title: null,
          source: "selected",
          isActive: false,
          isSelected: true,
        },
      ],
      alignment: {
        status: "mismatch",
        requiresReauth: true,
        message: "Selected expected channel does not match the active OAuth channel.",
        recommendedAction: "Reauthenticate with the expected channel or select the active channel.",
      },
      activeWriteChannel: { id: "UC_ACTIVE", title: "Active channel" },
      selectedChannelId: "UC_SELECTED",
      expectedChannelId: "UC_SELECTED",
      source: "stored",
      requiresReauth: true,
    }),
    selectWriteChannel: async ({ channelId }: { channelId: string }) => ({
      selectedChannelId: channelId,
      activeWriteChannel: { id: "UC_ACTIVE", title: "Active channel" },
      expectedChannelId: channelId,
      source: "stored",
      alignment: {
        status: "mismatch",
        requiresReauth: true,
        message: "Selected expected channel does not match the active OAuth channel.",
        recommendedAction: "Reauthenticate with the expected channel or select the active channel.",
      },
      knownChannels: [],
      requiresReauth: true,
      message: "Selected expected channel does not match the active OAuth channel.",
      recommendedAction: "Reauthenticate with the expected channel or select the active channel.",
    }),
    resolveEffectiveCredentialRef: async ({ explicit }: { explicit?: unknown }) =>
      (explicit as { userId: string } | undefined) ?? { userId: "active-user" },
  };
}

function makeApplyPayload(dryRun: boolean) {
  return {
    dryRun,
    videoId: "v1",
    targetLanguage: "es",
    languageSource: "defaultLanguage" as const,
    snippet: {
      before: { title: "Before", description: "Before desc", categoryId: "22" },
      proposed: { title: "After", description: "After desc", categoryId: "22" },
    },
    localizations: {
      before: {
        es: { title: "Antes", description: "Antes desc" },
      },
      proposed: {
        es: { title: "After", description: "After desc" },
      },
      affected: [
        {
          locale: "es",
          before: { title: "Antes", description: "Antes desc" },
          proposed: { title: "After", description: "After desc" },
          source: "defaultLanguage" as const,
        },
      ],
    },
  };
}

test("MCP whoami returns active local user", async () => {
  const handlers = createMcpToolHandlers(makeCoreStub(), makeAuthStub());
  const result = await handlers.whoami();

  assert.equal(result.isError, undefined);
  const payload = result.structuredContent as { userId: string; email: string };
  assert.equal(payload.userId, "active-user");
  assert.equal(payload.email, "active-user@example.com");
});

test("MCP server registers auth_user_select tool", () => {
  const server = createMcpServer(makeCoreStub());
  const tools = (server as unknown as { _registeredTools?: Record<string, unknown> })._registeredTools;

  assert.equal(Boolean(tools?.auth_user_select), true);
});

test("MCP write_context returns active write-channel contract", async () => {
  const handlers = createMcpToolHandlers(makeCoreStub(), makeAuthStub());
  const result = await handlers.writeContext();

  assert.equal(result.isError, undefined);
  const payload = result.structuredContent as {
    activeWriteChannel: { id: string };
    selectedChannelId: string;
    effectiveCredentialRef: { userId: string };
  };

  assert.equal(payload.activeWriteChannel.id, "UC_ACTIVE");
  assert.equal(payload.selectedChannelId, "UC_SELECTED");
  assert.deepEqual(payload.effectiveCredentialRef, { userId: "active-user" });
});

test("MCP write_channel_list returns minimal-safe known channel list", async () => {
  const handlers = createMcpToolHandlers(makeCoreStub(), makeAuthStub());
  const result = await handlers.writeChannelList({});

  assert.equal(result.isError, undefined);
  const payload = result.structuredContent as {
    knownChannels: Array<{ id: string; source: string }>;
    alignment: { status: string; requiresReauth: boolean };
  };
  assert.equal(payload.knownChannels.length, 2);
  assert.equal(payload.alignment.status, "mismatch");
  assert.equal(payload.alignment.requiresReauth, true);
});

test("MCP write_channel_select returns mismatch contract without implying OAuth switch", async () => {
  const handlers = createMcpToolHandlers(makeCoreStub(), makeAuthStub());
  const result = await handlers.writeChannelSelect({
    channelId: "UC1111111111111111111111",
  });

  assert.equal(result.isError, undefined);
  const payload = result.structuredContent as {
    selectedChannelId: string;
    alignment: { status: string; requiresReauth: boolean };
    message: string;
  };
  assert.equal(payload.selectedChannelId, "UC1111111111111111111111");
  assert.equal(payload.alignment.status, "mismatch");
  assert.equal(payload.alignment.requiresReauth, true);
  assert.match(payload.message, /does not match the active OAuth channel/i);
});

test("MCP write_channel_select rejects invalid payload before persistence", async () => {
  let selectCalled = false;
  const auth = makeAuthStub();
  auth.selectWriteChannel = async () => {
    selectCalled = true;
    throw new Error("should not be called");
  };

  const handlers = createMcpToolHandlers(makeCoreStub(), auth);
  const result = await handlers.writeChannelSelect({ channelId: "" });

  assert.equal(result.isError, true);
  assert.equal(selectCalled, false);
  const payload = JSON.parse(result.content[0]?.text ?? "{}");
  assert.equal(payload.error.code, "validation_failed");
});

test("MCP auth_user_select switches local active identity only", async () => {
  const handlers = createMcpToolHandlers(makeCoreStub(), makeAuthStub());
  const result = await handlers.authUserSelect({ userId: "user-b" });

  assert.equal(result.isError, undefined);
  const payload = result.structuredContent as {
    activeUser: { userId: string };
    previousActiveUserId: string;
    affectsRemoteOAuth: boolean;
  };
  assert.equal(payload.activeUser.userId, "user-b");
  assert.equal(payload.previousActiveUserId, "active-user");
  assert.equal(payload.affectsRemoteOAuth, false);
});

test("MCP auth_user_select rejects invalid payload before persistence", async () => {
  let selectCalled = false;
  const auth = makeAuthStub();
  auth.selectUser = async () => {
    selectCalled = true;
    throw new Error("should not be called");
  };

  const handlers = createMcpToolHandlers(makeCoreStub(), auth);
  const result = await handlers.authUserSelect({ userId: "" });

  assert.equal(result.isError, true);
  assert.equal(selectCalled, false);
  const payload = JSON.parse(result.content[0]?.text ?? "{}");
  assert.equal(payload.error.code, "validation_failed");
});

test("MCP auth_user_select returns AUTH_USER_NOT_FOUND as structured error", async () => {
  const auth = makeAuthStub();
  auth.selectUser = async () => {
    throw new DomainError({
      code: "AUTH_USER_NOT_FOUND",
      message: "Requested auth user does not exist in local storage",
      details: { userId: "missing-user", affectsRemoteOAuth: false },
    });
  };

  const handlers = createMcpToolHandlers(makeCoreStub(), auth);
  const result = await handlers.authUserSelect({ userId: "missing-user" });

  assert.equal(result.isError, true);
  const payload = JSON.parse(result.content[0]?.text ?? "{}");
  assert.equal(payload.error.code, "AUTH_USER_NOT_FOUND");
  assert.deepEqual(payload.error.details, {
    userId: "missing-user",
    affectsRemoteOAuth: false,
  });
});

test("MCP preview tool returns finalTitle and description for valid input", async () => {
  const handlers = createMcpToolHandlers(makeCoreStub(), makeAuthStub());

  const result = await handlers.preview({
    credentialRef: { userId: "user-1" },
    videoId: "v1",
    editorialPrompt: "Improve title",
  });

  assert.equal(result.isError, undefined);
  const structured = result.structuredContent as {
    draft: { finalTitle: string; description: string };
  };
  assert.equal(structured.draft.finalTitle, "Final");
  assert.equal(structured.draft.description, "Description");
});

test("MCP handlers reject invalid input with structured validation error", async () => {
  const handlers = createMcpToolHandlers(makeCoreStub(), makeAuthStub());

  const result = await handlers.preview({
    credentialRef: { userId: "user-1" },
    videoId: "v1",
  });

  assert.equal(result.isError, true);
  const payload = JSON.parse(result.content[0]?.text ?? "{}");
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "validation_failed");
  assert.equal(Array.isArray(payload.error.details), true);
});

test("MCP apply tool supports dry-run review without mutation", async () => {
  let capturedInput: unknown;
  const core = makeCoreStub();
  core.applyMetadata = async (input: unknown) => {
    capturedInput = input;
    return {
      dryRun: true,
      videoId: "v1",
      targetLanguage: "es",
      languageSource: "defaultLanguage" as const,
      snippet: {
        before: { title: "Before", description: "Before desc", categoryId: "22" },
        proposed: { title: "After", description: "After desc", categoryId: "22" },
      },
      localizations: {
        before: {
          es: { title: "Antes", description: "Antes desc" },
        },
        proposed: {
          es: { title: "After", description: "After desc" },
        },
        affected: [
          {
            locale: "es",
            before: { title: "Antes", description: "Antes desc" },
            proposed: { title: "After", description: "After desc" },
            source: "defaultLanguage" as const,
          },
        ],
      },
    };
  };

  const handlers = createMcpToolHandlers(core, makeAuthStub());
  const result = await handlers.apply({
    credentialRef: { userId: "user-1" },
    videoId: "v1",
    finalTitle: "After",
    description: "After desc",
    expectedChannelId: "UC_ACTIVE",
    dryRun: true,
  });

  assert.equal(result.isError, undefined);
  assert.deepEqual(capturedInput, {
    credentialRef: { userId: "user-1" },
    videoId: "v1",
    finalTitle: "After",
    description: "After desc",
    expectedChannelId: "UC_ACTIVE",
    dryRun: true,
  });

  const payload = result.structuredContent as {
    dryRun: boolean;
    targetLanguage: string;
    localizations: { affected: Array<{ locale: string }> };
  };
  assert.equal(payload.dryRun, true);
  assert.equal(payload.targetLanguage, "es");
  assert.equal(payload.localizations.affected[0]?.locale, "es");
});

test("MCP apply keeps structuredContent parity between dryRun and apply", async () => {
  const core = makeCoreStub();
  core.applyMetadata = async (input: unknown) => {
    const request = input as { dryRun?: boolean };
    return makeApplyPayload(request.dryRun === true);
  };

  const handlers = createMcpToolHandlers(core, makeAuthStub());

  const dryRunResult = await handlers.apply({
    videoId: "v1",
    finalTitle: "After",
    description: "After desc",
    expectedChannelId: "UC_ACTIVE",
    dryRun: true,
  });

  const applyResult = await handlers.apply({
    videoId: "v1",
    finalTitle: "After",
    description: "After desc",
    expectedChannelId: "UC_ACTIVE",
    dryRun: false,
  });

  assert.equal(dryRunResult.isError, undefined);
  assert.equal(applyResult.isError, undefined);

  const dryRunPayload = {
    ...(dryRunResult.structuredContent as Record<string, unknown>),
  };
  const applyPayload = {
    ...(applyResult.structuredContent as Record<string, unknown>),
  };

  assert.equal(dryRunPayload.dryRun, true);
  assert.equal(applyPayload.dryRun, false);
  delete dryRunPayload.dryRun;
  delete applyPayload.dryRun;
  assert.deepEqual(dryRunPayload, applyPayload);
});

test("MCP transcript keeps structuredContent and text payload aligned with diagnostics", async () => {
  const core = makeCoreStub();
  core.getTranscript = async () => ({
    transcript: {
      status: "unavailable",
      reason: "captions-not-downloadable",
      diagnostic: {
        stage: "captions-download",
        httpStatus: 403,
        apiReason: "forbidden",
        retriable: false,
      },
    },
  });

  const handlers = createMcpToolHandlers(core, makeAuthStub());
  const result = await handlers.transcript({ videoId: "v1" });

  assert.equal(result.isError, undefined);
  const payloadFromText = JSON.parse(result.content[0]?.text ?? "{}");
  assert.deepEqual(result.structuredContent, payloadFromText);
  assert.deepEqual(payloadFromText.transcript, {
    status: "unavailable",
    reason: "captions-not-downloadable",
    diagnostic: {
      stage: "captions-download",
      httpStatus: 403,
      apiReason: "forbidden",
      retriable: false,
    },
  });
});

test("MCP list uses active auth context when credentialRef is omitted", async () => {
  let capturedInput: unknown;
  const core = makeCoreStub();
  core.listVideos = async (input: unknown) => {
    capturedInput = input;
    return { videos: [] };
  };

  const handlers = createMcpToolHandlers(core, makeAuthStub());
  const result = await handlers.list({ maxResults: 5 });

  assert.equal(result.isError, undefined);
  assert.deepEqual(capturedInput, {
    credentialRef: { userId: "active-user" },
    maxResults: 5,
  });
});

test("MCP list forwards explicit channelId for multi-account setups", async () => {
  let capturedInput: unknown;
  const core = makeCoreStub();
  core.listVideos = async (input: unknown) => {
    capturedInput = input;
    return { videos: [] };
  };

  const handlers = createMcpToolHandlers(core, makeAuthStub());
  await handlers.list({ channelId: "IscmdXDtypp2zTzEEYxJwg", maxResults: 5 });

  assert.deepEqual(capturedInput, {
    credentialRef: { userId: "active-user" },
    channelId: "IscmdXDtypp2zTzEEYxJwg",
    maxResults: 5,
  });
});

test("MCP keeps explicit credentialRef precedence over active user", async () => {
  let capturedInput: unknown;
  const core = makeCoreStub();
  core.listVideos = async (input: unknown) => {
    capturedInput = input;
    return { videos: [] };
  };

  const handlers = createMcpToolHandlers(core, makeAuthStub());
  await handlers.list({ credentialRef: { userId: "explicit-user" } });

  assert.deepEqual(capturedInput, {
    credentialRef: { userId: "explicit-user" },
  });
});

test("MCP returns AUTH_USER_NOT_FOUND as structured error", async () => {
  const auth = {
    whoami: async () => ({
      userId: "active-user",
      email: "active-user@example.com",
      name: null,
      tokenExpiry: null,
      hasRefreshToken: true,
      isActive: true,
      activeWriteChannel: { id: "UC_ACTIVE", title: "Active channel" },
      selectedChannelId: "UC_SELECTED",
      alignment: {
        status: "mismatch",
        requiresReauth: true,
        message: "Selected expected channel does not match the active OAuth channel.",
        recommendedAction: "Reauthenticate with the expected channel or select the active channel.",
      },
      requiresReauth: true,
      knownChannels: [],
      writeChannel: {
        activeWriteChannel: { id: "UC_ACTIVE", title: "Active channel" },
        selectedChannelId: "UC_SELECTED",
        expectedChannelId: "UC_SELECTED",
        source: "stored",
        knownChannels: [],
        alignment: {
          status: "mismatch",
          requiresReauth: true,
          message: "Selected expected channel does not match the active OAuth channel.",
          recommendedAction: "Reauthenticate with the expected channel or select the active channel.",
        },
        requiresReauth: true,
      },
      effectiveCredentialRef: { userId: "active-user" },
    }),
    listKnownWriteChannels: async () => ({
      knownChannels: [],
      alignment: {
        status: "unresolved",
        requiresReauth: false,
        message: "No expected write channel is configured yet.",
        recommendedAction: "Select the expected channel before running sensitive write operations.",
      },
      activeWriteChannel: null,
      selectedChannelId: null,
      expectedChannelId: null,
      source: "missing",
      requiresReauth: false,
    }),
    selectWriteChannel: async () => ({
      selectedChannelId: "UC1111111111111111111111",
      activeWriteChannel: { id: "UC_ACTIVE", title: "Active channel" },
      expectedChannelId: "UC1111111111111111111111",
      source: "stored",
      alignment: {
        status: "mismatch",
        requiresReauth: true,
        message: "Selected expected channel does not match the active OAuth channel.",
        recommendedAction: "Reauthenticate with the expected channel or select the active channel.",
      },
      knownChannels: [],
      requiresReauth: true,
      message: "Selected expected channel does not match the active OAuth channel.",
      recommendedAction: "Reauthenticate with the expected channel or select the active channel.",
    }),
    selectUser: async () => ({
      activeUser: {
        userId: "active-user",
        email: "active-user@example.com",
        name: null,
        tokenExpiry: null,
        hasRefreshToken: true,
        isActive: true,
      },
      previousActiveUserId: "active-user",
      changed: false,
      effectiveCredentialRef: { userId: "active-user" },
      writeChannel: {
        activeWriteChannel: { id: "UC_ACTIVE", title: "Active channel" },
        selectedChannelId: "UC_SELECTED",
        expectedChannelId: "UC_SELECTED",
        source: "stored",
        knownChannels: [],
        alignment: {
          status: "mismatch",
          requiresReauth: true,
          message: "Selected expected channel does not match the active OAuth channel.",
          recommendedAction: "Reauthenticate with the expected channel or select the active channel.",
        },
        requiresReauth: true,
      },
      activeWriteChannel: { id: "UC_ACTIVE", title: "Active channel" },
      selectedChannelId: "UC_SELECTED",
      alignment: {
        status: "mismatch",
        requiresReauth: true,
        message: "Selected expected channel does not match the active OAuth channel.",
        recommendedAction: "Reauthenticate with the expected channel or select the active channel.",
      },
      requiresReauth: true,
      affectsRemoteOAuth: false as const,
    }),
    resolveEffectiveCredentialRef: async () => {
      throw new DomainError({
        code: "AUTH_USER_NOT_FOUND",
        message: "Active auth user does not exist",
      });
    },
  };

  const handlers = createMcpToolHandlers(makeCoreStub(), auth);
  const result = await handlers.list({});

  assert.equal(result.isError, true);
  const payload = JSON.parse(result.content[0]?.text ?? "{}");
  assert.equal(payload.error.code, "AUTH_USER_NOT_FOUND");
});

test("MCP returns AUTH_SCOPE_INSUFFICIENT as structured error", async () => {
  const core = makeCoreStub();
  core.applyMetadata = async () => {
    throw new DomainError({
      code: "AUTH_SCOPE_INSUFFICIENT",
      message: "Credentials are missing required OAuth scopes",
      details: { missingScopes: ["https://www.googleapis.com/auth/youtube"] },
    });
  };

  const handlers = createMcpToolHandlers(core, makeAuthStub());
  const result = await handlers.apply({
    videoId: "v1",
    finalTitle: "New",
    description: "New desc",
    expectedChannelId: "UC_ACTIVE",
  });

  assert.equal(result.isError, true);
  const payload = JSON.parse(result.content[0]?.text ?? "{}");
  assert.equal(payload.error.code, "AUTH_SCOPE_INSUFFICIENT");
});

test("MCP playlist_list uses active auth context when credentialRef is omitted", async () => {
  let capturedInput: unknown;
  const core = makeCoreStub();
  core.listPlaylists = async (input: unknown) => {
    capturedInput = input;
    return { playlists: [] };
  };

  const handlers = createMcpToolHandlers(core, makeAuthStub());
  const result = await handlers.playlistList({});

  assert.equal(result.isError, undefined);
  assert.deepEqual(capturedInput, {
    credentialRef: { userId: "active-user" },
  });
});

test("MCP playlist_create keeps explicit credentialRef precedence", async () => {
  let capturedInput: unknown;
  const core = makeCoreStub();
  core.createPlaylist = async (input: unknown) => {
    capturedInput = input;
    return {
      playlist: {
        id: "p-created",
        title: "My Playlist",
        description: "Roadtrip videos",
        privacyStatus: "private" as const,
      },
    };
  };

  const handlers = createMcpToolHandlers(core, makeAuthStub());
  const result = await handlers.playlistCreate({
    credentialRef: { userId: "explicit-user" },
    title: "My Playlist",
    description: "Roadtrip videos",
    expectedChannelId: "UC_ACTIVE",
  });

  assert.equal(result.isError, undefined);
  assert.deepEqual(capturedInput, {
    credentialRef: { userId: "explicit-user" },
    title: "My Playlist",
    description: "Roadtrip videos",
    expectedChannelId: "UC_ACTIVE",
    privacyStatus: "private",
  });

  const payload = result.structuredContent as {
    playlist: { id: string; title: string; description: string; privacyStatus: string };
  };
  assert.equal(payload.playlist.id, "p-created");
  assert.equal(payload.playlist.title, "My Playlist");
  assert.equal(payload.playlist.description, "Roadtrip videos");
  assert.equal(payload.playlist.privacyStatus, "private");
});

test("MCP playlist_update enforces patch schema and forwards payload", async () => {
  let capturedInput: unknown;
  const core = makeCoreStub();
  core.updatePlaylist = async (input: unknown) => {
    capturedInput = input;
    return {
      playlist: {
        id: "p-updated",
        title: "Updated",
        description: "Updated description",
        privacyStatus: "public" as const,
      },
    };
  };

  const handlers = createMcpToolHandlers(core, makeAuthStub());
  const result = await handlers.playlistUpdate({
    playlistId: "p-updated",
    expectedChannelId: "UC_ACTIVE",
    description: "Updated description",
    privacyStatus: "public",
  });

  assert.equal(result.isError, undefined);
  assert.deepEqual(capturedInput, {
    credentialRef: { userId: "active-user" },
    playlistId: "p-updated",
    expectedChannelId: "UC_ACTIVE",
    description: "Updated description",
    privacyStatus: "public",
  });
  assert.deepEqual(result.structuredContent, {
    playlist: {
      id: "p-updated",
      title: "Updated",
      description: "Updated description",
      privacyStatus: "public",
    },
  });
});

test("MCP playlist_delete enforces schema and forwards expectedChannelId", async () => {
  let capturedInput: unknown;
  const core = makeCoreStub();
  core.deletePlaylist = async (input: unknown) => {
    capturedInput = input;
    return { deleted: true, playlistId: "p-delete" };
  };

  const handlers = createMcpToolHandlers(core, makeAuthStub());
  const result = await handlers.playlistDelete({
    playlistId: "p-delete",
    expectedChannelId: "UC_ACTIVE",
  });

  assert.equal(result.isError, undefined);
  assert.deepEqual(capturedInput, {
    credentialRef: { userId: "active-user" },
    playlistId: "p-delete",
    expectedChannelId: "UC_ACTIVE",
  });

  assert.deepEqual(result.structuredContent, {
    deleted: true,
    playlistId: "p-delete",
  });
});

test("MCP playlist_* tools reject invalid input with structured validation errors", async () => {
  const handlers = createMcpToolHandlers(makeCoreStub(), makeAuthStub());

  const invalidCalls = [
    {
      toolName: "playlist_list",
      invoke: () => handlers.playlistList({ maxResults: 0 }),
    },
    {
      toolName: "playlist_create",
      invoke: () => handlers.playlistCreate({ title: "" }),
    },
    {
      toolName: "playlist_add_videos",
      invoke: () => handlers.playlistAddVideos({ playlistId: "p1", videoIds: [] }),
    },
    {
      toolName: "playlist_remove_videos",
      invoke: () => handlers.playlistRemoveVideos({ playlistId: "p1", videoIds: [] }),
    },
    {
      toolName: "playlist_delete",
      invoke: () => handlers.playlistDelete({ playlistId: "p1" }),
    },
    {
      toolName: "playlist_update",
      invoke: () => handlers.playlistUpdate({ playlistId: "p1", expectedChannelId: "UC_ACTIVE" }),
    },
  ];

  for (const invalidCall of invalidCalls) {
    const result = await invalidCall.invoke();
    assert.equal(result.isError, true, `${invalidCall.toolName} should return error`);

    const payload = JSON.parse(result.content[0]?.text ?? "{}");
    assert.equal(payload.ok, false, `${invalidCall.toolName} should return ok=false`);
    assert.equal(
      payload.error.code,
      "validation_failed",
      `${invalidCall.toolName} should return validation_failed`
    );
    assert.equal(
      Array.isArray(payload.error.details),
      true,
      `${invalidCall.toolName} should include validation details`
    );
  }
});

test("MCP playlist add/remove tools return stable partial contracts", async () => {
  const handlers = createMcpToolHandlers(makeCoreStub(), makeAuthStub());

  const addResult = await handlers.playlistAddVideos({
    playlistId: "p1",
    videoIds: ["v1", "v2"],
  });
  const removeResult = await handlers.playlistRemoveVideos({
    playlistId: "p1",
    videoIds: ["v1", "v2"],
  });

  assert.equal(addResult.isError, undefined);
  assert.equal(removeResult.isError, undefined);

  assert.deepEqual(addResult.structuredContent, {
    playlistId: "p1",
    attempted: 2,
    added: 1,
    failures: [{ videoId: "v2", reason: "already-present" }],
  });

  assert.deepEqual(removeResult.structuredContent, {
    playlistId: "p1",
    requested: 2,
    removed: 1,
    failures: [{ videoId: "v2", reason: "not-found-in-playlist" }],
  });
});

test("MCP apply returns target-language resolution errors as structured domain errors", async () => {
  const core = makeCoreStub();
  core.applyMetadata = async () => {
    throw new DomainError({
      code: "target_language_unresolvable",
      message:
        "Cannot resolve target language. Set snippet.defaultLanguage on the video or leave exactly one localization.",
      details: { localizationLocales: ["es", "en"] },
    });
  };

  const handlers = createMcpToolHandlers(core, makeAuthStub());
  const result = await handlers.apply({
    videoId: "v1",
    finalTitle: "Nuevo",
    description: "Nueva descripción",
    expectedChannelId: "UC_ACTIVE",
    dryRun: true,
  });

  assert.equal(result.isError, true);
  const payload = JSON.parse(result.content[0]?.text ?? "{}");
  assert.equal(payload.error.code, "target_language_unresolvable");
});

test("MCP apply returns guardrail mismatch details in structured error", async () => {
  const core = makeCoreStub();
  core.applyMetadata = async () => {
    throw new DomainError({
      code: "WRITE_CHANNEL_MISMATCH",
      message: "expectedChannelId does not match the active write channel",
      details: {
        expectedChannelId: "UC_EXPECTED",
        activeWriteChannelId: "UC_ACTIVE",
      },
    });
  };

  const handlers = createMcpToolHandlers(core, makeAuthStub());
  const result = await handlers.apply({
    videoId: "v1",
    finalTitle: "Nuevo",
    description: "Nueva descripción",
    expectedChannelId: "UC_EXPECTED",
  });

  assert.equal(result.isError, true);
  const payload = JSON.parse(result.content[0]?.text ?? "{}");
  assert.equal(payload.error.code, "WRITE_CHANNEL_MISMATCH");
  assert.deepEqual(payload.error.details, {
    expectedChannelId: "UC_EXPECTED",
    activeWriteChannelId: "UC_ACTIVE",
  });
});

test("MCP apply returns unresolved guardrail details in structured error", async () => {
  const core = makeCoreStub();
  core.applyMetadata = async () => {
    throw new DomainError({
      code: "WRITE_CHANNEL_UNRESOLVED",
      message: "Cannot resolve active write channel for the current OAuth session",
      details: {
        expectedChannelId: "UC_EXPECTED",
      },
    });
  };

  const handlers = createMcpToolHandlers(core, makeAuthStub());
  const result = await handlers.apply({
    videoId: "v1",
    finalTitle: "Nuevo",
    description: "Nueva descripción",
    expectedChannelId: "UC_EXPECTED",
  });

  assert.equal(result.isError, true);
  const payload = JSON.parse(result.content[0]?.text ?? "{}");
  assert.equal(payload.error.code, "WRITE_CHANNEL_UNRESOLVED");
  assert.deepEqual(payload.error.details, {
    expectedChannelId: "UC_EXPECTED",
  });
});

test("MCP playlist_create fails closed on guardrail mismatch with stable details", async () => {
  const core = makeCoreStub();
  core.createPlaylist = async () => {
    throw new DomainError({
      code: "WRITE_CHANNEL_MISMATCH",
      message: "expectedChannelId does not match the active write channel",
      details: {
        expectedChannelId: "UC_EXPECTED",
        activeWriteChannelId: "UC_ACTIVE",
      },
    });
  };

  const handlers = createMcpToolHandlers(core, makeAuthStub());
  const result = await handlers.playlistCreate({
    title: "Roadtrip",
    expectedChannelId: "UC_EXPECTED",
  });

  assert.equal(result.isError, true);
  const payload = JSON.parse(result.content[0]?.text ?? "{}");
  assert.equal(payload.error.code, "WRITE_CHANNEL_MISMATCH");
  assert.deepEqual(payload.error.details, {
    expectedChannelId: "UC_EXPECTED",
    activeWriteChannelId: "UC_ACTIVE",
  });
});

test("MCP playlist_update fails closed on guardrail mismatch with stable details", async () => {
  const core = makeCoreStub();
  core.updatePlaylist = async () => {
    throw new DomainError({
      code: "WRITE_CHANNEL_MISMATCH",
      message: "expectedChannelId does not match the active write channel",
      details: {
        expectedChannelId: "UC_EXPECTED",
        activeWriteChannelId: "UC_ACTIVE",
      },
    });
  };

  const handlers = createMcpToolHandlers(core, makeAuthStub());
  const result = await handlers.playlistUpdate({
    playlistId: "p-update",
    expectedChannelId: "UC_EXPECTED",
    title: "Updated",
  });

  assert.equal(result.isError, true);
  const payload = JSON.parse(result.content[0]?.text ?? "{}");
  assert.equal(payload.error.code, "WRITE_CHANNEL_MISMATCH");
  assert.deepEqual(payload.error.details, {
    expectedChannelId: "UC_EXPECTED",
    activeWriteChannelId: "UC_ACTIVE",
  });
});

test("MCP playlist_update fails closed on invalid ownership with structured error details", async () => {
  const core = makeCoreStub();
  core.updatePlaylist = async () => {
    throw new DomainError({
      code: "WRITE_CHANNEL_MISMATCH",
      message: "Playlist does not belong to the active write channel",
      details: {
        expectedChannelId: "UC_ACTIVE",
        activeWriteChannelId: "UC_OTHER",
      },
    });
  };

  const handlers = createMcpToolHandlers(core, makeAuthStub());
  const result = await handlers.playlistUpdate({
    playlistId: "p-update",
    expectedChannelId: "UC_ACTIVE",
    description: "Updated description",
  });

  assert.equal(result.isError, true);
  const payload = JSON.parse(result.content[0]?.text ?? "{}");
  assert.equal(payload.error.code, "WRITE_CHANNEL_MISMATCH");
  assert.match(payload.error.message, /does not belong to the active write channel/);
  assert.deepEqual(payload.error.details, {
    expectedChannelId: "UC_ACTIVE",
    activeWriteChannelId: "UC_OTHER",
  });
});

test("MCP playlist_delete fails closed on unresolved channel with stable details", async () => {
  const core = makeCoreStub();
  core.deletePlaylist = async () => {
    throw new DomainError({
      code: "WRITE_CHANNEL_UNRESOLVED",
      message: "Cannot resolve active write channel for the current OAuth session",
      details: {
        expectedChannelId: "UC_ACTIVE",
      },
    });
  };

  const handlers = createMcpToolHandlers(core, makeAuthStub());
  const result = await handlers.playlistDelete({
    playlistId: "p-delete",
    expectedChannelId: "UC_ACTIVE",
  });

  assert.equal(result.isError, true);
  const payload = JSON.parse(result.content[0]?.text ?? "{}");
  assert.equal(payload.error.code, "WRITE_CHANNEL_UNRESOLVED");
  assert.deepEqual(payload.error.details, {
    expectedChannelId: "UC_ACTIVE",
  });
});

const bestPublishTimesResult = {
  kind: "best-publish-times" as const,
  timezone: "America/Argentina/Buenos_Aires",
  analyzedVideos: 12,
  excludedVideos: 1,
  channelMedianEarlyViews: 1000,
  confidence: "normal" as const,
  slots: [
    {
      weekday: "tuesday" as const,
      startHour: 18,
      endHour: 21,
      score: 1.4,
      sampleSize: 3,
      medianEarlyViews: 1400,
    },
  ],
  method: {
    maxVideos: 50,
    minVideoAgeDays: 4,
    earlyWindowDays: 3,
    slotHours: 3,
    minSlotSamples: 2,
  },
};

test("MCP best_publish_times forwards timezone and resolved credentialRef to the core", async () => {
  const calls: unknown[] = [];
  const core = {
    ...makeCoreStub(),
    fetchBestPublishTimes: async (input: { credentialRef: unknown; timezone: string }) => {
      calls.push(input);
      return bestPublishTimesResult;
    },
  };

  const handlers = createMcpToolHandlers(core, makeAuthStub());
  const fallback = await handlers.bestPublishTimes({ timezone: "America/Argentina/Buenos_Aires" });
  await handlers.bestPublishTimes({
    timezone: "UTC",
    credentialRef: { userId: "explicit-user" },
  });

  assert.equal(fallback.isError, undefined);
  assert.deepEqual(fallback.structuredContent, bestPublishTimesResult);
  assert.deepEqual(JSON.parse(fallback.content[0]?.text ?? "{}"), bestPublishTimesResult);
  assert.deepEqual(calls, [
    { credentialRef: { userId: "active-user" }, timezone: "America/Argentina/Buenos_Aires" },
    { credentialRef: { userId: "explicit-user" }, timezone: "UTC" },
  ]);
});

test("MCP best_publish_times rejects missing or empty timezone before calling the core", async () => {
  let called = false;
  const core = {
    ...makeCoreStub(),
    fetchBestPublishTimes: async () => {
      called = true;
      return bestPublishTimesResult;
    },
  };

  const handlers = createMcpToolHandlers(core, makeAuthStub());
  for (const input of [{}, { timezone: "" }]) {
    const result = await handlers.bestPublishTimes(input);
    assert.equal(result.isError, true);
    const payload = JSON.parse(result.content[0]?.text ?? "{}");
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, "validation_failed");
  }
  assert.equal(called, false);
});

test("MCP best_publish_times surfaces core errors with the structured error envelope", async () => {
  const core = {
    ...makeCoreStub(),
    fetchBestPublishTimes: async () => ({
      kind: "best-publish-times-error" as const,
      code: "AUTH_SCOPE_INSUFFICIENT" as const,
      message: "Reauthorization with the yt-analytics.readonly scope is required.",
      requiredScopes: ["yt-analytics.readonly"] as ["yt-analytics.readonly"],
    }),
  };

  const handlers = createMcpToolHandlers(core, makeAuthStub());
  const result = await handlers.bestPublishTimes({ timezone: "UTC" });

  assert.equal(result.isError, true);
  assert.equal(result.structuredContent, undefined);
  assert.deepEqual(JSON.parse(result.content[0]?.text ?? "{}"), {
    ok: false,
    error: {
      code: "AUTH_SCOPE_INSUFFICIENT",
      message: "Reauthorization with the yt-analytics.readonly scope is required.",
      details: { requiredScopes: ["yt-analytics.readonly"] },
    },
  });
});

const TOOLS_BEFORE_SOCIAL = [
  "apply",
  "auth_user_select",
  "best_publish_times",
  "list",
  "playlist_add_videos",
  "playlist_create",
  "playlist_delete",
  "playlist_list",
  "playlist_remove_videos",
  "playlist_update",
  "preview",
  "transcript",
  "upload_cancel",
  "upload_multi",
  "upload_reconcile",
  "upload_reconcile_many",
  "whoami",
  "write_channel_list",
  "write_channel_select",
  "write_context",
];

const SOCIAL_TOOLS = [
  "social_accounts",
  "social_cancel",
  "social_confirm",
  "social_preview",
  "social_queue",
  "social_reschedule",
  "social_stage_video",
];

test("MCP server registers the previous tools plus upload recovery and social tools", () => {
  const server = createMcpServer({
    ...makeCoreStub(),
    fetchBestPublishTimes: async () => bestPublishTimesResult,
  });
  const tools = (server as unknown as { _registeredTools?: Record<string, unknown> })._registeredTools;

  assert.deepEqual(Object.keys(tools ?? {}).sort(), [...TOOLS_BEFORE_SOCIAL, ...SOCIAL_TOOLS].sort());
});

test("MCP social tool descriptions state the preview/confirm boundary", () => {
  const server = createMcpServer(makeCoreStub());
  const tools = (server as unknown as { _registeredTools?: Record<string, { description?: string }> })._registeredTools ?? {};

  const preview = tools.social_preview?.description ?? "";
  assert.match(preview, /does NOT publish/);
  assert.match(preview, /explicit human approval/i);
  const confirm = tools.social_confirm?.description ?? "";
  assert.match(confirm, /irreversibl/i);
  assert.match(confirm, /explicitly approved/i);
  assert.match(confirm, /web app must be running/i);
});

// --- Social publishing tools (S12) ---

const SOCIAL_POST = {
  id: "post-1",
  userId: "active-user",
  accountId: "acc-1",
  platform: "tiktok" as const,
  stagingFile: "clip.mp4",
  caption: "New video",
  platformOptions: { privacyLevel: "SELF_ONLY" },
  scheduledAtUtc: "2026-10-22T13:00:00.000Z",
  timezone: "America/Argentina/Buenos_Aires",
  status: "draft" as const,
  createdAt: "2026-10-21T12:00:00.000Z",
  updatedAt: "2026-10-21T12:00:00.000Z",
};

const SOCIAL_PREVIEW = {
  post: SOCIAL_POST,
  scheduledAtUtc: SOCIAL_POST.scheduledAtUtc,
  account: { id: "acc-1", platform: "tiktok" as const, displayName: "@gentleman" },
  video: { stagingFile: "clip.mp4", size: 11 },
  confirmationToken: `1792000000.${"a".repeat(64)}`,
  confirmationExpiresAt: "2026-10-21T12:10:00.000Z",
};

const SOCIAL_ACCOUNT = {
  id: "acc-1",
  userId: "active-user",
  platform: "tiktok" as const,
  externalAccountId: "tt-1",
  displayName: "@gentleman",
  scopes: ["video.publish"],
  tokenExpiresAt: null,
  connectedAt: "2026-10-21T12:00:00.000Z",
};

function makeSocialStub(overrides: Partial<Record<string, (input: unknown) => Promise<unknown>>> = {}) {
  const calls: Array<{ method: string; input: unknown }> = [];
  const record = (method: string, result: unknown) => async (input: unknown) => {
    calls.push({ method, input });
    return overrides[method] ? overrides[method](input) : result;
  };
  const queue = {
    preview: record("preview", { ok: true, value: SOCIAL_PREVIEW }),
    confirm: record("confirm", { ok: true, value: { ...SOCIAL_POST, status: "scheduled" } }),
    reschedule: record("reschedule", { ok: true, value: SOCIAL_PREVIEW }),
    cancel: record("cancel", { ok: true, value: { ...SOCIAL_POST, status: "cancelled" } }),
    list: record("list", { ok: true, value: [SOCIAL_POST] }),
  };
  const social = {
    configuredPlatforms: () => ["tiktok" as const],
    listAccounts: async (userId: string) => {
      calls.push({ method: "listAccounts", input: userId });
      // Extra fields simulate a future storage leak; the tool must drop them.
      return [{ ...SOCIAL_ACCOUNT, accessToken: "secret-token" }] as unknown as (typeof SOCIAL_ACCOUNT)[];
    },
    stageLocalFile: async (path: string) => {
      calls.push({ method: "stageLocalFile", input: path });
      if (overrides.stageLocalFile) return overrides.stageLocalFile(path) as Promise<{ stagingFile: string; size: number }>;
      return { stagingFile: "3f0c8a2e-1111-4222-8333-444455556666.mp4", size: 11 };
    },
    queue: async () => queue as never,
  };
  return { social, calls };
}

function parseText(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0]?.text ?? "{}");
}

const AT_SCHEDULE = { mode: "at", localDateTime: "2026-10-22T10:00:00", timezone: "America/Argentina/Buenos_Aires" };

test("MCP social_accounts returns public account fields and configured platforms for the active user", async () => {
  const { social, calls } = makeSocialStub();
  const handlers = createMcpToolHandlers({ ...makeCoreStub(), social }, makeAuthStub());

  const result = await handlers.socialAccounts({});

  assert.equal(result.isError, undefined);
  const payload = result.structuredContent as { accounts: unknown[]; configuredPlatforms: string[] };
  assert.deepEqual(payload.accounts, [
    {
      id: "acc-1",
      platform: "tiktok",
      externalAccountId: "tt-1",
      displayName: "@gentleman",
      scopes: ["video.publish"],
      tokenExpiresAt: null,
      connectedAt: "2026-10-21T12:00:00.000Z",
    },
  ]);
  assert.deepEqual(payload.configuredPlatforms, ["tiktok"]);
  assert.doesNotMatch(result.content[0]?.text ?? "", /secret-token/);
  assert.deepEqual(calls, [{ method: "listAccounts", input: "active-user" }]);
});

test("MCP social tools honor an explicit userId credentialRef and reject token credentials", async () => {
  const { social, calls } = makeSocialStub();
  const handlers = createMcpToolHandlers({ ...makeCoreStub(), social }, makeAuthStub());

  await handlers.socialQueue({ credentialRef: { userId: "explicit-user" } });
  const rejected = await handlers.socialQueue({ credentialRef: { accessToken: "raw" } });

  assert.deepEqual(calls, [{ method: "list", input: { userId: "explicit-user" } }]);
  assert.equal(rejected.isError, true);
  assert.equal(parseText(rejected).error.code, "validation_failed");
});

test("MCP social_stage_video forwards the absolute path and returns the staged name and size", async () => {
  const { social, calls } = makeSocialStub();
  const handlers = createMcpToolHandlers({ ...makeCoreStub(), social }, makeAuthStub());

  const result = await handlers.socialStageVideo({ path: "/Users/me/Videos/clip.mp4" });

  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, { stagingFile: "3f0c8a2e-1111-4222-8333-444455556666.mp4", size: 11 });
  assert.deepEqual(calls, [{ method: "stageLocalFile", input: "/Users/me/Videos/clip.mp4" }]);
});

test("MCP social_stage_video maps staging failures to the structured error envelope", async () => {
  const failure = Object.assign(new Error("Unsupported video extension; use mp4, mov, webm or mkv"), { code: "INVALID_INPUT" });
  const { social } = makeSocialStub({
    stageLocalFile: async () => {
      throw failure;
    },
  });
  const handlers = createMcpToolHandlers({ ...makeCoreStub(), social }, makeAuthStub());

  const result = await handlers.socialStageVideo({ path: "/Users/me/notes.txt" });

  assert.equal(result.isError, true);
  assert.deepEqual(parseText(result), {
    ok: false,
    error: { code: "INVALID_INPUT", message: "Unsupported video extension; use mp4, mov, webm or mkv" },
  });
});

test("MCP social_preview forwards userId and input, returns the preview with its token and only calls preview", async () => {
  const { social, calls } = makeSocialStub();
  const handlers = createMcpToolHandlers({ ...makeCoreStub(), social }, makeAuthStub());
  const input = {
    platform: "tiktok",
    stagingFile: "clip.mp4",
    caption: "New video",
    platformOptions: { privacyLevel: "SELF_ONLY" },
    schedule: AT_SCHEDULE,
  };

  const result = await handlers.socialPreview(input);

  assert.equal(result.isError, undefined);
  const payload = result.structuredContent as typeof SOCIAL_PREVIEW & { nextStep: string };
  assert.equal(payload.confirmationToken, SOCIAL_PREVIEW.confirmationToken);
  assert.deepEqual(payload.post, SOCIAL_POST);
  assert.equal(payload.post.status, "draft");
  assert.match(payload.nextStep, /social_confirm/);
  assert.deepEqual(calls, [{ method: "preview", input: { userId: "active-user", ...input } }]);
});

test("MCP social_confirm forwards userId, postId and the confirmation token", async () => {
  const { social, calls } = makeSocialStub();
  const handlers = createMcpToolHandlers({ ...makeCoreStub(), social }, makeAuthStub());

  const result = await handlers.socialConfirm({ postId: "post-1", confirmationToken: SOCIAL_PREVIEW.confirmationToken });

  assert.equal(result.isError, undefined);
  assert.equal((result.structuredContent as { post: { status: string } }).post.status, "scheduled");
  assert.deepEqual(calls, [
    { method: "confirm", input: { userId: "active-user", postId: "post-1", confirmationToken: SOCIAL_PREVIEW.confirmationToken } },
  ]);
});

test("MCP social_queue, social_cancel and social_reschedule forward userId and input", async () => {
  const { social, calls } = makeSocialStub();
  const handlers = createMcpToolHandlers({ ...makeCoreStub(), social }, makeAuthStub());

  const listed = await handlers.socialQueue({ status: "scheduled" });
  const cancelled = await handlers.socialCancel({ postId: "post-1" });
  const rescheduled = await handlers.socialReschedule({ postId: "post-1", schedule: { mode: "now" } });

  assert.deepEqual((listed.structuredContent as { posts: unknown[] }).posts, [SOCIAL_POST]);
  assert.equal((cancelled.structuredContent as { post: { status: string } }).post.status, "cancelled");
  assert.equal((rescheduled.structuredContent as { confirmationToken: string }).confirmationToken, SOCIAL_PREVIEW.confirmationToken);
  assert.deepEqual(calls, [
    { method: "list", input: { userId: "active-user", status: "scheduled" } },
    { method: "cancel", input: { userId: "active-user", postId: "post-1" } },
    { method: "reschedule", input: { userId: "active-user", postId: "post-1", schedule: { mode: "now" } } },
  ]);
});

test("MCP social tools return queue errors with the structured error envelope", async () => {
  const { social } = makeSocialStub({
    confirm: async () => ({ ok: false, error: { code: "CONFIRMATION_EXPIRED", message: "The confirmation expired; preview the post again" } }),
  });
  const handlers = createMcpToolHandlers({ ...makeCoreStub(), social }, makeAuthStub());

  const result = await handlers.socialConfirm({ postId: "post-1", confirmationToken: "1.abc" });

  assert.equal(result.isError, true);
  assert.equal(result.structuredContent, undefined);
  assert.deepEqual(parseText(result), {
    ok: false,
    error: { code: "CONFIRMATION_EXPIRED", message: "The confirmation expired; preview the post again" },
  });
});

test("MCP social tools reject invalid input without calling the core", async () => {
  const { social, calls } = makeSocialStub();
  const handlers = createMcpToolHandlers({ ...makeCoreStub(), social }, makeAuthStub());
  const validPreview = {
    platform: "tiktok",
    stagingFile: "clip.mp4",
    caption: "New video",
    platformOptions: { privacyLevel: "SELF_ONLY" },
    schedule: AT_SCHEDULE,
  };

  const invalid: Array<[keyof ReturnType<typeof createMcpToolHandlers>, unknown]> = [
    ["socialStageVideo", {}],
    ["socialStageVideo", { path: "" }],
    ["socialStageVideo", { path: "/a/clip.mp4", extra: true }],
    ["socialPreview", { ...validPreview, platform: "x" }],
    ["socialPreview", { ...validPreview, caption: "" }],
    ["socialPreview", { ...validPreview, schedule: { mode: "later" } }],
    ["socialPreview", { ...validPreview, schedule: { mode: "at", localDateTime: "tomorrow", timezone: "UTC" } }],
    ["socialPreview", { ...validPreview, confirmationToken: "smuggled" }],
    ["socialConfirm", { postId: "post-1" }],
    ["socialConfirm", { confirmationToken: "1.abc" }],
    ["socialQueue", { status: "unknown" }],
    ["socialCancel", {}],
    ["socialReschedule", { postId: "post-1" }],
    ["socialAccounts", { extra: 1 }],
  ];
  for (const [method, input] of invalid) {
    const result = await (handlers[method] as (input: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>)(input);
    assert.equal(result.isError, true, `${method} ${JSON.stringify(input)}`);
    assert.equal(parseText(result).error.code, "validation_failed");
  }
  assert.deepEqual(calls, []);
});

test("MCP social tools surface a missing active auth context as AUTH_USER_NOT_FOUND", async () => {
  const { social, calls } = makeSocialStub();
  const auth = {
    ...makeAuthStub(),
    resolveEffectiveCredentialRef: async () => {
      throw new DomainError({ code: "AUTH_USER_NOT_FOUND", message: "No active auth context. Run `auth login` first." });
    },
  };
  const handlers = createMcpToolHandlers({ ...makeCoreStub(), social }, auth);

  const result = await handlers.socialQueue({});

  assert.equal(result.isError, true);
  assert.equal(parseText(result).error.code, "AUTH_USER_NOT_FOUND");
  assert.deepEqual(calls, []);
});

test("MCP social_preview leaves the post in draft and only social_confirm schedules it (real queue, in-memory db)", async (t) => {
  const { createClient } = await import("@libsql/client");
  const { createSocialStorage, initializeSocialTables } = await import("@/lib/social/storage");
  const { createSocialQueueService } = await import("@/lib/social/queue/service");
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const stagingRoot = await mkdtemp(join(tmpdir(), "mcp-social-"));
  t.after(() => rm(stagingRoot, { recursive: true, force: true }));
  await writeFile(join(stagingRoot, "clip.mp4"), "video-bytes");
  const client = createClient({ url: ":memory:" });
  await initializeSocialTables(client);
  const secret = "test-nextauth-secret-value";
  const storage = createSocialStorage({ client, secret });
  await storage.upsertAccount(
    "active-user",
    "tiktok",
    { externalAccountId: "tt-1", displayName: "@gentleman", scopes: ["video.publish"] },
    { accessToken: "access" },
  );
  const queue = createSocialQueueService({ storage, secret, stagingRoot });
  const { social } = makeSocialStub();
  const handlers = createMcpToolHandlers(
    { ...makeCoreStub(), social: { ...social, listAccounts: (userId: string) => storage.listAccounts(userId), queue: async () => queue } },
    makeAuthStub(),
  );

  const preview = await handlers.socialPreview({
    platform: "tiktok",
    stagingFile: "clip.mp4",
    caption: "New video",
    platformOptions: { privacyLevel: "SELF_ONLY" },
    schedule: { mode: "at", localDateTime: "2099-01-01T10:00:00", timezone: "UTC" },
  });
  assert.equal(preview.isError, undefined, preview.content[0]?.text);
  const { post, confirmationToken } = preview.structuredContent as { post: { id: string }; confirmationToken: string };
  assert.equal((await storage.getPost("active-user", post.id))?.status, "draft");
  const accounts = await handlers.socialAccounts({});
  assert.doesNotMatch(accounts.content[0]?.text ?? "", /access/);

  const wrong = await handlers.socialConfirm({ postId: post.id, confirmationToken: `${confirmationToken.split(".")[0]}.${"0".repeat(64)}` });
  assert.equal(parseText(wrong).error.code, "CONFIRMATION_INVALID");
  assert.equal((await storage.getPost("active-user", post.id))?.status, "draft");

  const confirmed = await handlers.socialConfirm({ postId: post.id, confirmationToken });
  assert.equal(confirmed.isError, undefined, confirmed.content[0]?.text);
  assert.equal((await storage.getPost("active-user", post.id))?.status, "scheduled");
});
