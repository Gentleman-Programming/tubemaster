import assert from "node:assert/strict";
import test from "node:test";
import { createMcpServer, createMcpToolHandlers } from "./server";

type UploadCoreStub = {
  multiUpload(userId: string, input: unknown): Promise<unknown>;
  reconcile(input: unknown): Promise<unknown>;
  reconcileMany(input: unknown): Promise<unknown>;
  cancel(input: unknown): Promise<unknown>;
};

function makeAuth() {
  return {
    resolveEffectiveCredentialRef: async () => ({ userId: "active-user" }),
    whoami: async () => ({ userId: "active-user" }),
    selectUser: async () => ({ ok: true }),
    listKnownWriteChannels: async () => ({ knownChannels: [] }),
    selectWriteChannel: async () => ({ ok: true }),
  };
}

const baseCore = {
  listVideos: async () => ({ videos: [] }),
  getTranscript: async () => ({ transcript: { status: "available", text: "" } }),
  previewMetadata: async () => ({}),
  applyMetadata: async () => ({}),
  listPlaylists: async () => ({ playlists: [] }),
  createPlaylist: async () => ({}),
  updatePlaylist: async () => ({}),
  deletePlaylist: async () => ({}),
  addVideosToPlaylist: async () => ({}),
  removeVideosFromPlaylist: async () => ({}),
};

const items = [{
  stagingFile: "video.mp4",
  title: "Video",
  description: "Description",
  tags: ["one", "two"],
  categoryId: "22",
  defaultLanguage: "en",
  defaultAudioLanguage: "en",
  license: "youtube",
  selfDeclaredMadeForKids: false,
  containsSyntheticMedia: true,
}];

test("MCP upload handlers bind the active user and preserve preview/confirm payloads", async () => {
  const calls: unknown[] = [];
  const upload: UploadCoreStub = {
    multiUpload: async (userId, input) => { calls.push(["multi", userId, input]); return { status: "validated", confirmationToken: "token" }; },
    reconcile: async (input) => { calls.push(["reconcile", input]); return { status: "unknown", operationId: "op", retryAutomatically: false }; },
    reconcileMany: async (input) => { calls.push(["reconcileMany", input]); return { status: "completed", items: [] }; },
    cancel: async (input) => { calls.push(["cancel", input]); return { status: "validated", confirmationToken: "token" }; },
  };
  const handlers = createMcpToolHandlers({ ...baseCore, upload } as never, makeAuth() as never);

  assert.equal((await handlers.uploadMulti({ expectedChannelId: "UC_ACTIVE", items, dryRun: true })).isError, undefined);
  assert.equal((await handlers.uploadMulti({ expectedChannelId: "UC_ACTIVE", items, confirmed: true, confirmationToken: "token" })).isError, undefined);
  assert.equal((await handlers.uploadReconcile({ expectedChannelId: "UC_ACTIVE", operationId: "op", videoId: "v1" })).isError, undefined);
  assert.equal((await handlers.uploadReconcileMany({ expectedChannelId: "UC_ACTIVE", items: [{ operationId: "op", videoId: "v1" }] })).isError, undefined);
  assert.equal((await handlers.uploadCancel({ expectedChannelId: "UC_ACTIVE", operationId: "op", videoId: "v1", dryRun: true })).isError, undefined);

  assert.deepEqual(calls, [
    ["multi", "active-user", { expectedChannelId: "UC_ACTIVE", items, dryRun: true }],
    ["multi", "active-user", { expectedChannelId: "UC_ACTIVE", items, confirmed: true, confirmationToken: "token" }],
    ["reconcile", { credentialRef: { userId: "active-user" }, expectedChannelId: "UC_ACTIVE", operationId: "op", videoId: "v1" }],
    ["reconcileMany", { credentialRef: { userId: "active-user" }, expectedChannelId: "UC_ACTIVE", items: [{ operationId: "op", videoId: "v1" }] }],
    ["cancel", { credentialRef: { userId: "active-user" }, expectedChannelId: "UC_ACTIVE", operationId: "op", videoId: "v1", dryRun: true }],
  ]);
});

test("MCP upload handlers reject malformed input before core calls", async () => {
  let called = false;
  const upload = {
    multiUpload: async () => { called = true; return {}; },
    reconcile: async () => { called = true; return {}; },
    reconcileMany: async () => { called = true; return {}; },
    cancel: async () => { called = true; return {}; },
  };
  const handlers = createMcpToolHandlers({ ...baseCore, upload } as never, makeAuth() as never);
  const result = await handlers.uploadReconcile({ expectedChannelId: "UC_ACTIVE" });
  assert.equal(result.isError, true);
  assert.equal(called, false);
});

test("MCP server registers upload and recovery tools", () => {
  const server = createMcpServer({ ...baseCore, upload: {} } as never);
  const tools = (server as unknown as { _registeredTools?: Record<string, unknown> })._registeredTools ?? {};
  for (const name of ["upload_multi", "upload_reconcile", "upload_reconcile_many", "upload_cancel"]) assert.equal(Boolean(tools[name]), true);
});
