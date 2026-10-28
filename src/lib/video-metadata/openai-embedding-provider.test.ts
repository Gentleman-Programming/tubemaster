import assert from "node:assert/strict";
import test from "node:test";
import { createOpenAIEmbeddingProvider } from "./openai-embedding-provider";
import { createTranscriptEmbeddingInput } from "./transcript-embedding";

const input = createTranscriptEmbeddingInput({
  videoId: "dQw4w9WgXcQ",
  chunkIndex: 0,
  text: "Transcript text",
  order: 0,
  provider: "openai",
  model: "text-embedding-3-small",
});

test("OpenAI provider sends a batched embeddings request and maps vectors", async () => {
  let request: RequestInit | undefined;
  const provider = createOpenAIEmbeddingProvider({
    apiKey: "test-key",
    fetcher: async (_url, init) => {
      request = init;
      return new Response(JSON.stringify({
        model: "text-embedding-3-small",
        data: [{ index: 0, embedding: [1, 0] }],
      }), { status: 200 });
    },
  });

  const result = await provider.embed(input);
  assert.deepEqual(result.vector, [1, 0]);
  assert.equal(result.provider, "openai");
  assert.equal(request?.headers && new Headers(request.headers).get("Authorization"), "Bearer test-key");
  assert.match(String(request?.body), /text-embedding-3-small/);
});

test("OpenAI provider fails safely when the API key is missing", async () => {
  const provider = createOpenAIEmbeddingProvider({ apiKey: "", fetcher: fetch });
  await assert.rejects(provider.embed(input), /OpenAI embeddings are not configured/);
});
