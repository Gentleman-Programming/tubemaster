import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stageLocalFile, StageLocalFileError } from "../stage-local-file";

async function withDirs(run: (dirs: { source: string; root: string }) => Promise<void>) {
  const base = await mkdtemp(join(tmpdir(), "social-stage-local-"));
  const source = join(base, "source");
  await mkdir(source);
  try {
    await run({ source, root: join(base, "staging") });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

const UUID_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp4$/;
const isInvalid = (error: unknown) => error instanceof StageLocalFileError && error.code === "INVALID_INPUT";

test("copies a valid file into the staging root under a UUID name with mode 0600", async () => {
  await withDirs(async ({ source, root }) => {
    const path = join(source, "My Clip.MP4");
    const content = Buffer.from("fake video bytes");
    await writeFile(path, content);
    const before = await stat(path);

    const result = await stageLocalFile({ path, stagingRoot: root, maxBytes: 1024 });

    assert.match(result.stagingFile, UUID_NAME);
    assert.equal(result.size, content.length);
    const target = join(root, result.stagingFile);
    assert.deepEqual(await readFile(target), content);
    assert.equal((await stat(target)).mode & 0o777, 0o600);
    assert.equal((await stat(root)).mode & 0o777, 0o700);
    // The source is copied, never moved or modified.
    const after = await stat(path);
    assert.deepEqual(await readFile(path), content);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(after.ino, before.ino);
  });
});

test("each copy gets a fresh name", async () => {
  await withDirs(async ({ source, root }) => {
    const path = join(source, "clip.mp4");
    await writeFile(path, "bytes");
    const first = await stageLocalFile({ path, stagingRoot: root, maxBytes: 1024 });
    const second = await stageLocalFile({ path, stagingRoot: root, maxBytes: 1024 });
    assert.notEqual(first.stagingFile, second.stagingFile);
    assert.equal((await readdir(root)).length, 2);
  });
});

test("rejects a symlink even when it points at a valid video", async () => {
  await withDirs(async ({ source, root }) => {
    await writeFile(join(source, "real.mp4"), "bytes");
    await symlink(join(source, "real.mp4"), join(source, "link.mp4"));
    await assert.rejects(stageLocalFile({ path: join(source, "link.mp4"), stagingRoot: root, maxBytes: 1024 }), isInvalid);
  });
});

test("rejects a directory, a missing file, a relative path and an empty file", async () => {
  await withDirs(async ({ source, root }) => {
    await mkdir(join(source, "folder.mp4"));
    await writeFile(join(source, "empty.mp4"), "");
    for (const path of [join(source, "folder.mp4"), join(source, "missing.mp4"), "clip.mp4", join(source, "empty.mp4")]) {
      await assert.rejects(stageLocalFile({ path, stagingRoot: root, maxBytes: 1024 }), isInvalid, path);
    }
  });
});

test("rejects unsupported extensions", async () => {
  await withDirs(async ({ source, root }) => {
    for (const name of ["notes.txt", "clip", "clip.mp4.exe", "archive.zip"]) {
      await writeFile(join(source, name), "bytes");
      await assert.rejects(stageLocalFile({ path: join(source, name), stagingRoot: root, maxBytes: 1024 }), isInvalid, name);
    }
  });
});

test("rejects a file larger than the size limit and leaves nothing staged", async () => {
  await withDirs(async ({ source, root }) => {
    const path = join(source, "big.mov");
    await writeFile(path, Buffer.alloc(11));
    await assert.rejects(stageLocalFile({ path, stagingRoot: root, maxBytes: 10 }), isInvalid);
    const staged = await readdir(root).catch(() => []);
    assert.deepEqual(staged, []);
  });
});

test("rejects a symlinked staging root", async () => {
  await withDirs(async ({ source, root }) => {
    const path = join(source, "clip.webm");
    await writeFile(path, "bytes");
    const realRoot = join(source, "real-root");
    await mkdir(realRoot);
    await symlink(realRoot, root);
    await assert.rejects(stageLocalFile({ path, stagingRoot: root, maxBytes: 1024 }), isInvalid);
    assert.deepEqual(await readdir(realRoot), []);
  });
});
