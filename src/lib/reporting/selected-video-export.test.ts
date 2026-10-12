import assert from "node:assert/strict";
import test from "node:test";
import { selectLoadedVideos, serializeSelectedVideosCsv, serializeSelectedVideosJson } from "./selected-video-export";

const videos = [
  { videoId: "a", title: 'Hello, "world"', description: "first\r\nsecond", publishedAt: "2025-01-01T00:00:00Z", extra: "not exported" },
  { videoId: "b", title: "=SUM(1,2)", description: "\t+42", publishedAt: "2025-01-02T00:00:00Z" },
  { videoId: "c", title: "other", description: "plain", publishedAt: "2025-01-03T00:00:00Z" },
];

test("selection follows loaded order, not visible title filter, and ignores stale IDs", () => {
  assert.deepEqual(selectLoadedVideos(videos, new Set(["b", "a", "stale"])).map((v) => v.videoId), ["a", "b"]);
  assert.deepEqual(selectLoadedVideos(videos, new Set(["stale"])), []);
});

test("JSON includes precisely four unchanged fields", () => {
  assert.deepEqual(JSON.parse(serializeSelectedVideosJson(selectLoadedVideos(videos, new Set(["a", "b"])))), [
    { videoId: "a", title: 'Hello, "world"', description: "first\r\nsecond", publishedAt: "2025-01-01T00:00:00Z" },
    { videoId: "b", title: "=SUM(1,2)", description: "\t+42", publishedAt: "2025-01-02T00:00:00Z" },
  ]);
});

test("CSV quotes commas, quotes, CR/LF and neutralizes formula-leading cells", () => {
  assert.equal(serializeSelectedVideosCsv(selectLoadedVideos(videos, new Set(["a", "b"]))),
    'videoId,title,description,publishedAt\r\na,"Hello, ""world""","first\r\nsecond",2025-01-01T00:00:00Z\r\nb,"\'=SUM(1,2)","\'\t+42",2025-01-02T00:00:00Z');
  assert.equal(serializeSelectedVideosCsv([]), "videoId,title,description,publishedAt");
});
