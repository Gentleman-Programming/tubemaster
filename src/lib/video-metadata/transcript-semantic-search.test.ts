import assert from "node:assert/strict";
import test from "node:test";
import {
  searchTranscriptEmbeddings,
  type TranscriptSemanticSearchCandidate,
} from "./transcript-semantic-search";
import {
  createTranscriptEmbeddingOutput,
  type TranscriptEmbeddingOutput,
} from "./transcript-embedding";

function candidate(
  videoId: string,
  chunkIndex: number,
  vector: readonly number[],
  text: string,
  order: number,
  overrides: Partial<TranscriptEmbeddingOutput> = {}
): TranscriptSemanticSearchCandidate {
  const embedding = createTranscriptEmbeddingOutput({
    videoId,
    chunkIndex,
    vector,
    order,
    provider: "test-provider",
    model: "test-model",
  });

  return {
    embedding: { ...embedding, ...overrides },
    text,
  };
}

test("ranks compatible transcript chunks by cosine similarity", () => {
  const results = searchTranscriptEmbeddings(
    {
      vector: [1, 0],
      provider: "test-provider",
      model: "test-model",
    },
    [
      candidate("video-1", 0, [0, 1], "unrelated", 0),
      candidate("video-1", 1, [1, 0], "best match", 1),
      candidate("video-2", 0, [0.8, 0.6], "second match", 0),
    ]
  );

  assert.deepEqual(
    results.map((result) => ({ identity: result.identity, text: result.text, score: result.score })),
    [
      {
        identity: JSON.stringify(["transcript-chunk", "video-1", 1]),
        text: "best match",
        score: 1,
      },
      {
        identity: JSON.stringify(["transcript-chunk", "video-2", 0]),
        text: "second match",
        score: 0.8,
      },
      {
        identity: JSON.stringify(["transcript-chunk", "video-1", 0]),
        text: "unrelated",
        score: 0,
      },
    ]
  );
});

test("uses source order and identity for deterministic score ties", () => {
  const results = searchTranscriptEmbeddings(
    { vector: [1, 0], provider: "test-provider", model: "test-model" },
    [
      candidate("video-b", 0, [1, 0], "later source", 2),
      candidate("video-a", 1, [1, 0], "first source", 1),
      candidate("video-a", 0, [1, 0], "same source order", 1),
    ]
  );

  assert.deepEqual(
    results.map((result) => result.text),
    ["same source order", "first source", "later source"]
  );
});

test("supports video filtering, score threshold, and bounded limits", () => {
  const results = searchTranscriptEmbeddings(
    {
      vector: [1, 0],
      provider: "test-provider",
      model: "test-model",
    },
    [
      candidate("video-1", 0, [1, 0], "keep", 0),
      candidate("video-1", 1, [0.5, 0.5], "drop by threshold", 1),
      candidate("video-2", 0, [1, 0], "drop by video", 0),
    ],
    { videoId: "video-1", minimumScore: 0.8, limit: 1 }
  );

  assert.equal(results.length, 1);
  assert.equal(results[0]?.text, "keep");
});

test("rejects empty, non-finite, or dimension-mismatched query vectors", () => {
  assert.throws(
    () =>
      searchTranscriptEmbeddings(
        { vector: [], provider: "test-provider", model: "test-model" },
        []
      ),
    /Embedding dimension must be a positive integer/
  );
  assert.throws(
    () =>
      searchTranscriptEmbeddings(
        { vector: [Number.NaN], provider: "test-provider", model: "test-model" },
        []
      ),
    /Embedding vector must contain only finite numbers/
  );
  assert.throws(
    () =>
      searchTranscriptEmbeddings(
        { vector: [1, 0, 0], provider: "test-provider", model: "test-model" },
        [candidate("video-1", 0, [1, 0], "wrong dimension", 0)]
      ),
    /dimension mismatch/i
  );
});

test("rejects incompatible candidate metadata and malformed source text", () => {
  assert.throws(
    () =>
      searchTranscriptEmbeddings(
        { vector: [1, 0], provider: "query-provider", model: "test-model" },
        [candidate("video-1", 0, [1, 0], "provider mismatch", 0)]
      ),
    /provider\/model metadata/i
  );

  assert.throws(
    () =>
      searchTranscriptEmbeddings(
        { vector: [1, 0], provider: "test-provider", model: "test-model" },
        [candidate("video-1", 0, [1, 0], "", 0)]
      ),
    /text must not be empty/i
  );
});

test("returns no matches for an empty candidate set", () => {
  assert.deepEqual(
    searchTranscriptEmbeddings(
      { vector: [1, 0], provider: "test-provider", model: "test-model" },
      []
    ),
    []
  );
});
