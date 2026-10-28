import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, symlink, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUploadAdapter } from "./adapter";

const input = { stagingFile: "video.mp4", expectedChannelId: "channel", title: "Title", tags: ["one"], categoryId: "22", defaultLanguage: "en", defaultAudioLanguage: "en", license: "youtube", selfDeclaredMadeForKids: false, containsSyntheticMedia: true, confirmed: true };

test("staging validation rejects unsafe references before calling core", async () => {
  const root = await mkdtemp(join(tmpdir(), "upload-adapter-"));
  await writeFile(join(root, "video.mp4"), "video");
  await symlink(join(root, "video.mp4"), join(root, "link.mp4"));
  let calls = 0;
  const upload = createUploadAdapter({ stagingRoot: root, maxBytes: 4, upload: async () => { calls++; return { status: "validated", operationId: "op", channelId: "channel", dryRun: true }; } });
  for (const stagingFile of ["../video.mp4", "link.mp4", "absent.mp4", "video.txt"]) {
    await assert.rejects(upload("user", { ...input, stagingFile }), { code: "validation_failed" });
  }
  await assert.rejects(upload("user", { ...input, confirmed: false }), { code: "validation_failed" });
  assert.equal(calls, 0);
  const limited = createUploadAdapter({ stagingRoot: root, maxBytes: 3, upload: async () => { calls++; throw new Error("unexpected"); } });
  await assert.rejects(limited("user", input), { code: "validation_failed" });
  assert.equal(calls, 0);
});

test("passes only private user-scoped requests to core, including dry runs", async () => {
  const root = await mkdtemp(join(tmpdir(), "upload-adapter-"));
  await writeFile(join(root, "video.mp4"), "video");
  const requests: unknown[] = [];
  const upload = createUploadAdapter({ stagingRoot: root, maxBytes: 10, upload: async (request) => {
    requests.push(request);
    return { status: "validated", operationId: "op", channelId: "channel", dryRun: true };
  } });
  assert.equal((await upload("user", { ...input, dryRun: true, confirmed: false })).status, "validated");
  assert.deepEqual(requests, [{ credentialRef: { userId: "user" }, expectedChannelId: "channel", filePath: join(root, "video.mp4"), title: "Title", description: undefined, tags: ["one"], categoryId: "22", defaultLanguage: "en", defaultAudioLanguage: "en", license: "youtube", selfDeclaredMadeForKids: false, containsSyntheticMedia: true, visibility: "private", dryRun: true, confirmed: false }]);
  assert.deepEqual(await readdir(root), ["video.mp4"]);
});

test("real upload reads private snapshot, cleans it on success and core failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "upload-adapter-"));
  await writeFile(join(root, "video.mp4"), "original");
  let snapshotPath = "";
  const upload = createUploadAdapter({ stagingRoot: root, maxBytes: 20, upload: async (request) => {
    const { filePath } = request as { filePath: string };
    snapshotPath = filePath;
    assert.notEqual(filePath, join(root, "video.mp4"));
    assert.match(filePath, /\.upload-snapshot-/);
    assert.equal(await readFile(filePath, "utf8"), "original");
    assert.equal((await stat(filePath)).mode & 0o777, 0o600);
    await writeFile(join(root, "video.mp4"), "changed");
    assert.equal(await readFile(filePath, "utf8"), "original");
    return { status: "uploaded", operationId: "op", channelId: "channel", videoId: "v", visibility: "private", dryRun: false };
  } });
  assert.equal((await upload("user", input)).status, "uploaded");
  assert.deepEqual(await readdir(root), ["video.mp4"]);
  assert.notEqual(snapshotPath, "");
  const failing = createUploadAdapter({ stagingRoot: root, maxBytes: 20, upload: async () => { throw new Error("core failed"); } });
  await assert.rejects(failing("user", input), /core failed/);
  assert.deepEqual(await readdir(root), ["video.mp4"]);
});
