import assert from "node:assert/strict";
import test from "node:test";
import { createSemanticSearchService } from "./semantic-search-service";
import { createTranscriptEmbeddingOutput, type TranscriptEmbeddingInput } from "./transcript-embedding";
import type { TranscriptEmbeddingStorage } from "./transcript-embedding-storage";

function storageFixture() {
  let entries: Awaited<ReturnType<TranscriptEmbeddingStorage["list"]>> = [];
  const storage: TranscriptEmbeddingStorage = {
    async replaceAll(userId, videoId, next) { void userId; void videoId; entries = [...next]; },
    async list(userId) { void userId; return entries; },
  };
  return { storage, get entries() { return entries; } };
}

test("indexes a transcript into per-user persisted embeddings", async () => {
  const fixture = storageFixture();
  const provider = {
    provider: "openai",
    model: "test-model",
    async embed(input: TranscriptEmbeddingInput) {
      return createTranscriptEmbeddingOutput({ ...input, vector: [1, 0] });
    },
    async embedMany(inputs: readonly TranscriptEmbeddingInput[]) {
      return inputs.map((input) => createTranscriptEmbeddingOutput({ ...input, vector: [1, 0] }));
    },
  };
  const service = createSemanticSearchService({
    storage: fixture.storage,
    embeddingProvider: provider,
    getTranscript: async () => ({ status: "available", text: "First paragraph.\n\nSecond paragraph." }),
  });

  const result = await service.indexVideo({ userId: "user-1", videoId: "dQw4w9WgXcQ" });
  assert.equal(result.chunkCount, 2);
  assert.equal(fixture.entries.length, 2);
  assert.equal(fixture.entries[0]?.text, "First paragraph.");
});

test("searches only the authenticated user's indexed embeddings", async () => {
  const fixture = storageFixture();
  const provider = {
    provider: "openai",
    model: "test-model",
    async embed(input: TranscriptEmbeddingInput) {
      return createTranscriptEmbeddingOutput({ ...input, vector: [1, 0] });
    },
    async embedMany() { return []; },
  };
  const service = createSemanticSearchService({ storage: fixture.storage, embeddingProvider: provider, getTranscript: async () => ({ status: "available", text: "unused" }) });
  await fixture.storage.replaceAll("user-1", "dQw4w9WgXcQ", [{
    text: "matching result",
    embedding: createTranscriptEmbeddingOutput({ videoId: "dQw4w9WgXcQ", chunkIndex: 0, vector: [1, 0], order: 0, provider: "openai", model: "test-model" }),
  }]);
  const results = await service.search({ userId: "user-1", query: "find this" });
  assert.equal(results[0]?.text, "matching result");
});
