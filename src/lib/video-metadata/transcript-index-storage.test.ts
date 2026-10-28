import assert from "node:assert/strict";
import test from "node:test";
import { buildTranscriptIndex } from "./transcript-index";
import { createTranscriptIndexStorage } from "./transcript-index-storage";

test("transcript index storage replaces entries atomically and preserves duplicates", async () => {
  const storage = createTranscriptIndexStorage();
  const videoId = `storage-test-${Date.now()}-${Math.random()}`;
  const entries = buildTranscriptIndex(videoId, [
    { index: 2, text: "same" },
    { index: 2, text: "same" },
    { index: 1, text: "first" },
  ]);

  try {
    await storage.replaceAll(videoId, entries);

    assert.deepEqual(await storage.list(videoId), entries);
  } finally {
    await storage.deleteByVideo(videoId);
  }
});

test("transcript index storage supports empty replacement and delete by video", async () => {
  const storage = createTranscriptIndexStorage();
  const videoId = `storage-test-empty-${Date.now()}-${Math.random()}`;

  try {
    await storage.replaceAll(videoId, [
      {
        videoId,
        chunkIndex: 0,
        text: "old",
        identity: JSON.stringify(["transcript-chunk", videoId, 0]),
        order: 0,
      },
    ]);
    await storage.replaceAll(videoId, []);
    assert.deepEqual(await storage.list(videoId), []);

    await storage.replaceAll(videoId, [
      {
        videoId,
        chunkIndex: 1,
        text: "new",
        identity: JSON.stringify(["transcript-chunk", videoId, 1]),
        order: 0,
      },
    ]);
    await storage.deleteByVideo(videoId);
    assert.deepEqual(await storage.list(videoId), []);
  } finally {
    await storage.deleteByVideo(videoId);
  }
});
