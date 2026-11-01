import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SemanticSearchPage, filterChannelVideos, loadChannelVideos, selectAllVideoIds, type ChannelVideo } from "./semantic-search-page";

test("semantic search page exposes separate index and search actions", () => {
  const markup = renderToStaticMarkup(<SemanticSearchPage />);
  assert.match(markup, />Semantic search</);
  assert.match(markup, /Index selected videos/);
  assert.match(markup, /Index one video/);
  assert.match(markup, /Search indexed transcripts/);
  assert.match(markup, /semantic-video/);
  assert.match(markup, /semantic-query/);
  assert.match(markup, /Index one video/);
  assert.match(markup, /Search transcripts/);
});

test("channel video helpers filter and select only loaded videos", () => {
  const videos: ChannelVideo[] = [
    { videoId: "video-1", title: "Strategy talk", description: "", publishedAt: "2026-01-01" },
    { videoId: "video-2", title: "Behind the scenes", description: "", publishedAt: "2026-01-02" },
  ];
  assert.deepEqual(filterChannelVideos(videos, "strategy").map((video) => video.videoId), ["video-1"]);
  assert.deepEqual(selectAllVideoIds(videos), ["video-1", "video-2"]);
});

test("channel video loader maps unauthorized and malformed responses safely", async () => {
  await assert.rejects(() => loadChannelVideos(async () => new Response(null, { status: 401 })), /Sign in/);
  await assert.rejects(() => loadChannelVideos(async () => new Response("{}", { status: 200 })), /Invalid channel video response/);
});
