import assert from "node:assert/strict";
import test from "node:test";
import { runCliCommand } from "./video-metadata";

type UploadCoreStub = {
  multiUpload(userId: string, input: unknown): Promise<unknown>;
  reconcile(input: unknown): Promise<unknown>;
  reconcileMany(input: unknown): Promise<unknown>;
  cancel(input: unknown): Promise<unknown>;
};

function makeCore(overrides: Partial<UploadCoreStub> = {}) {
  return {
    multiUpload: async () => ({ status: "validated", confirmationToken: "token" }),
    reconcile: async () => ({ status: "unknown", operationId: "op", retryAutomatically: false }),
    reconcileMany: async () => ({ status: "completed", items: [] }),
    cancel: async () => ({ status: "validated", confirmationToken: "token" }),
    ...overrides,
  };
}

function makeAuth() {
  return { resolveEffectiveCredentialRef: async () => ({ userId: "active-user" }) };
}

const commandInput = JSON.stringify([{ stagingFile: "video.mp4", title: "Video", description: "Description" }]);

test("CLI upload multi forwards staged items and preserves preview/confirm boundary", async () => {
  const calls: unknown[] = [];
  const core = makeCore({ multiUpload: async (userId, input) => { calls.push([userId, input]); return { status: "validated", confirmationToken: "token" }; } });
  const stdout: string[] = [];

  const previewExit = await runCliCommand({
    argv: ["upload", "multi", "--expectedChannelId", "UC_ACTIVE", "--items", commandInput, "--dryRun"],
    core: core as never,
    auth: makeAuth() as never,
    writeStdout: (line) => stdout.push(line),
  });
  const confirmedExit = await runCliCommand({
    argv: ["upload", "multi", "--expectedChannelId", "UC_ACTIVE", "--items", commandInput, "--confirmed", "--confirmationToken", "token"],
    core: core as never,
    auth: makeAuth() as never,
    writeStdout: (line) => stdout.push(line),
  });

  assert.equal(previewExit, 0);
  assert.equal(confirmedExit, 0);
  assert.deepEqual(calls, [
    ["active-user", { expectedChannelId: "UC_ACTIVE", items: JSON.parse(commandInput), dryRun: true }],
    ["active-user", { expectedChannelId: "UC_ACTIVE", items: JSON.parse(commandInput), confirmed: true, confirmationToken: "token" }],
  ]);
  assert.equal(JSON.parse(stdout[0] ?? "{}").ok, true);
  assert.equal(JSON.parse(stdout[1] ?? "{}").ok, true);
});

test("CLI upload multi rejects apply without explicit confirmation before core", async () => {
  let called = false;
  const stderr: string[] = [];
  const exit = await runCliCommand({
    argv: ["upload", "multi", "--expectedChannelId", "UC_ACTIVE", "--items", commandInput],
    core: makeCore({ multiUpload: async () => { called = true; return {}; } }) as never,
    auth: makeAuth() as never,
    writeStderr: (line) => stderr.push(line),
  });
  assert.equal(exit, 1);
  assert.equal(called, false);
  assert.match(JSON.parse(stderr[0] ?? "{}").error.message, /Missing required --confirmed/);
});

test("CLI recovery commands bind the active user and preserve ordered results", async () => {
  const calls: unknown[] = [];
  const stdout: string[] = [];
  const core = makeCore({
    reconcile: async (input) => { calls.push(["reconcile", input]); return { status: "succeeded", operationId: "op", videoId: "v1" }; },
    reconcileMany: async (input) => { calls.push(["reconcileMany", input]); return { status: "completed", items: [{ index: 0, operationId: "op", status: "absent" }] }; },
    cancel: async (input) => { calls.push(["cancel", input]); return { status: "cancelled", operationId: "op", dryRun: false }; },
  });
  const options = { core: core as never, auth: makeAuth() as never, writeStdout: (line: string) => stdout.push(line) };

  assert.equal(await runCliCommand({ argv: ["upload", "reconcile", "--expectedChannelId", "UC_ACTIVE", "--operationId", "op", "--videoId", "v1"], ...options }), 0);
  assert.equal(await runCliCommand({ argv: ["upload", "reconcile-many", "--expectedChannelId", "UC_ACTIVE", "--items", JSON.stringify([{ operationId: "op", videoId: "v1" }])], ...options }), 0);
  assert.equal(await runCliCommand({ argv: ["upload", "cancel", "--expectedChannelId", "UC_ACTIVE", "--operationId", "op", "--videoId", "v1", "--dryRun"], ...options }), 0);
  assert.equal(await runCliCommand({ argv: ["upload", "cancel", "--expectedChannelId", "UC_ACTIVE", "--operationId", "op", "--videoId", "v1", "--confirmed", "--confirmationToken", "token"], ...options }), 0);

  assert.deepEqual(calls, [
    ["reconcile", { credentialRef: { userId: "active-user" }, expectedChannelId: "UC_ACTIVE", operationId: "op", videoId: "v1" }],
    ["reconcileMany", { credentialRef: { userId: "active-user" }, expectedChannelId: "UC_ACTIVE", items: [{ operationId: "op", videoId: "v1" }] }],
    ["cancel", { credentialRef: { userId: "active-user" }, expectedChannelId: "UC_ACTIVE", operationId: "op", videoId: "v1", dryRun: true }],
    ["cancel", { credentialRef: { userId: "active-user" }, expectedChannelId: "UC_ACTIVE", operationId: "op", videoId: "v1", dryRun: false, confirmed: true, confirmationToken: "token" }],
  ]);
});
