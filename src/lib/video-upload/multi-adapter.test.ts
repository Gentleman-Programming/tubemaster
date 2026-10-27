import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createMultiUploadAdapter } from "./multi-adapter";

test("validates the complete staged collection before invoking the core", async () => {
  const root = await mkdtemp(join(tmpdir(), "tubemaster-multi-adapter-"));
  try {
    await writeFile(join(root, "one.mp4"), "one");
    let calls = 0;
    const adapter = createMultiUploadAdapter({
      stagingRoot: root, maxBytes: 100,
      async upload() { calls++; throw new Error("must not run"); },
    });
    await assert.rejects(adapter("owner", { expectedChannelId: "channel", dryRun: true, items: [
      { stagingFile: "one.mp4", title: "One" },
      { stagingFile: "missing.mp4", title: "Missing" },
    ] }), { code: "validation_failed" });
    assert.equal(calls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("snapshots confirmed staged files and removes the snapshot after core execution", async () => {
  const root = await mkdtemp(join(tmpdir(), "tubemaster-multi-adapter-"));
  try {
    await writeFile(join(root, "one.mp4"), "one");
    let receivedPath = "";
    const adapter = createMultiUploadAdapter({
      stagingRoot: root, maxBytes: 100,
      async upload(_userId, input) {
        const item = (input as { items: Array<{ filePath: string }> }).items[0]!;
        receivedPath = item.filePath;
        assert.equal(await readFile(item.filePath, "utf8"), "one");
        return { status: "completed", operationId: "batch", channelId: "channel", items: [], dryRun: false };
      },
    });
    const result = await adapter("owner", { expectedChannelId: "channel", confirmed: true, confirmationToken: "token", items: [{ stagingFile: "one.mp4", title: "One" }] });
    assert.equal(result.status, "completed");
    assert.match(receivedPath, /\.multi-upload-snapshot-/);
    await assert.rejects(readFile(receivedPath));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects symlinked staged files", async () => {
  const root = await mkdtemp(join(tmpdir(), "tubemaster-multi-adapter-"));
  const outside = await mkdtemp(join(tmpdir(), "tubemaster-multi-outside-"));
  try {
    await writeFile(join(outside, "outside.mp4"), "outside");
    await symlink(join(outside, "outside.mp4"), join(root, "link.mp4"));
    const adapter = createMultiUploadAdapter({ stagingRoot: root, maxBytes: 100, async upload() { throw new Error("must not run"); } });
    await assert.rejects(adapter("owner", { dryRun: true, expectedChannelId: "channel", items: [{ stagingFile: "link.mp4", title: "Link" }] }), { code: "validation_failed" });
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
