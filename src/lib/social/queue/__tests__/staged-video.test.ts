import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveStagedVideo, StagedVideoError } from "../staged-video";

async function withStaging(run: (dirs: { base: string; root: string }) => Promise<void>) {
  const base = await mkdtemp(join(tmpdir(), "social-staged-video-"));
  const root = join(base, "staging");
  await mkdir(root);
  try {
    await run({ base, root });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

const isInvalid = (error: unknown) => error instanceof StagedVideoError && error.code === "STAGED_VIDEO_INVALID";

test("valid staged file resolves to its path, size and streaming sha256", async () => {
  await withStaging(async ({ root }) => {
    const content = Buffer.from("fake video bytes");
    await writeFile(join(root, "clip.mp4"), content);

    const video = await resolveStagedVideo({ stagingRoot: root, stagingFile: "clip.mp4" });

    assert.equal(video.path, join(root, "clip.mp4"));
    assert.equal(video.size, content.length);
    assert.equal(video.sha256, createHash("sha256").update(content).digest("hex"));
  });
});

test("traversal, bad names and unsupported extensions are rejected", async () => {
  await withStaging(async ({ base, root }) => {
    await writeFile(join(base, "outside.mp4"), "outside");
    await writeFile(join(root, "notes.txt"), "text");
    for (const stagingFile of ["../outside.mp4", "sub/clip.mp4", ".hidden.mp4", "..", "", "notes.txt", "clip"]) {
      await assert.rejects(resolveStagedVideo({ stagingRoot: root, stagingFile }), isInvalid, stagingFile);
    }
  });
});

test("symlinked staging root and symlinked files are rejected", async () => {
  await withStaging(async ({ base, root }) => {
    await writeFile(join(root, "clip.mp4"), "video");
    const linkedRoot = join(base, "linked-root");
    await symlink(root, linkedRoot);
    await assert.rejects(resolveStagedVideo({ stagingRoot: linkedRoot, stagingFile: "clip.mp4" }), isInvalid);

    await writeFile(join(base, "target.mp4"), "outside");
    await symlink(join(base, "target.mp4"), join(root, "link.mp4"));
    await assert.rejects(resolveStagedVideo({ stagingRoot: root, stagingFile: "link.mp4" }), isInvalid);
  });
});

test("missing, empty and non-regular files are rejected", async () => {
  await withStaging(async ({ root }) => {
    await assert.rejects(resolveStagedVideo({ stagingRoot: root, stagingFile: "missing.mp4" }), isInvalid);
    await writeFile(join(root, "empty.mp4"), "");
    await assert.rejects(resolveStagedVideo({ stagingRoot: root, stagingFile: "empty.mp4" }), isInvalid);
    await mkdir(join(root, "folder.mp4"));
    await assert.rejects(resolveStagedVideo({ stagingRoot: root, stagingFile: "folder.mp4" }), isInvalid);
  });
});
