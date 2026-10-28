import assert from "node:assert/strict";
import test from "node:test";
import { createSemanticSearchIndexHandler } from "./route";

const service = {
  async indexVideo() { return { videoId: "dQw4w9WgXcQ", chunkCount: 2, model: "test-model" }; },
  async search() { return []; },
};

test("semantic index route requires authentication", async () => {
  const handler = createSemanticSearchIndexHandler({ getSession: async () => null, service });
  const response = await handler(new Request("http://localhost/api/video-metadata/semantic-search/index", { method: "POST", body: JSON.stringify({ videoId: "dQw4w9WgXcQ" }) }));
  assert.equal(response.status, 401);
});

test("semantic index route returns the indexed chunk count", async () => {
  const handler = createSemanticSearchIndexHandler({ getSession: async () => ({ user: { id: "user-1" } }), service });
  const response = await handler(new Request("http://localhost/api/video-metadata/semantic-search/index", { method: "POST", body: JSON.stringify({ videoId: "dQw4w9WgXcQ" }) }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).chunkCount, 2);
});
