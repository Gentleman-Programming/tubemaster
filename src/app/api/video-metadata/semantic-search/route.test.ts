import assert from "node:assert/strict";
import test from "node:test";
import { createSemanticSearchHandler } from "./route";

const service = {
  async indexVideo() { return { videoId: "dQw4w9WgXcQ", chunkCount: 1, model: "test-model" }; },
  async search() { return [{ identity: "chunk", videoId: "dQw4w9WgXcQ", chunkIndex: 0, text: "match", order: 0, score: 1, provider: "openai", model: "test-model", dimension: 2 }]; },
};

test("semantic search route requires authentication", async () => {
  const handler = createSemanticSearchHandler({ getSession: async () => null, service });
  const response = await handler(new Request("http://localhost/api/video-metadata/semantic-search", { method: "POST", body: JSON.stringify({ query: "match" }) }));
  assert.equal(response.status, 401);
});

test("semantic search route validates query and returns results", async () => {
  const handler = createSemanticSearchHandler({ getSession: async () => ({ user: { id: "user-1" } }), service });
  const response = await handler(new Request("http://localhost/api/video-metadata/semantic-search", { method: "POST", body: JSON.stringify({ query: "match", limit: 5 }) }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).results[0].text, "match");
});

test("semantic search route rejects an invalid limit before calling the service", async () => {
  let called = false;
  const handler = createSemanticSearchHandler({
    getSession: async () => ({ user: { id: "user-1" } }),
    service: { ...service, async search() { called = true; return []; } },
  });
  const response = await handler(new Request("http://localhost/api/video-metadata/semantic-search", { method: "POST", body: JSON.stringify({ query: "match", limit: 99 }) }));
  assert.equal(response.status, 400);
  assert.equal(called, false);
});
