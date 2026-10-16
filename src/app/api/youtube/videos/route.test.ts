import assert from "node:assert/strict";
import { test } from "node:test";
import { filterPrivateVideos } from "./route";

const videos = [
  { videoId: "private-1", title: "Private one", description: "", publishedAt: "2030-01-01T00:00:00Z" },
  { videoId: "public-1", title: "Public one", description: "", publishedAt: "2030-01-02T00:00:00Z" },
];

test("private video filtering keeps only private statuses and preserves list order", () => {
  assert.deepEqual(
    filterPrivateVideos(videos, [
      { id: "public-1", status: { privacyStatus: "public" } },
      { id: "private-1", status: { privacyStatus: "private" } },
      { id: "missing-status", status: null },
    ]),
    [videos[0]],
  );
});
