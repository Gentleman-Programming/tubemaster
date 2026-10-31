import assert from "node:assert/strict";
import test from "node:test";
import {
  createTranscriptEmbeddingInput,
  createTranscriptEmbeddingIdentity,
  createTranscriptEmbeddingOutput,
  replaceTranscriptEmbeddings,
  validateTranscriptEmbeddingDimension,
  validateTranscriptEmbeddingOutput,
  type TranscriptEmbeddingResult,
} from "./transcript-embedding";

const metadata = { provider: "provider-a", model: "model-a" };
const output = (videoId: string, chunkIndex: number, order: number, vector: number[] = [0.1]) =>
  createTranscriptEmbeddingOutput({ videoId, chunkIndex, order, vector, ...metadata });

test("rejects an empty transcript chunk", () => {
  assert.throws(
    () => createTranscriptEmbeddingInput({ videoId: "video-1", chunkIndex: 0, text: "  \n\t", order: 0, ...metadata }),
    /Transcript chunk text must not be empty/
  );
});

test("creates a stable identity for replacement and re-indexing while carrying metadata", () => {
  const first = createTranscriptEmbeddingInput({ videoId: "video:1", chunkIndex: 2, text: "hello", order: 0, ...metadata });
  const replacement = createTranscriptEmbeddingInput({ videoId: "video:1", chunkIndex: 2, text: "updated text", order: 0, provider: "other", model: "other" });
  assert.equal(first.identity, replacement.identity);
  assert.equal(first.identity, createTranscriptEmbeddingIdentity("video:1", 2));
  assert.equal(first.provider, metadata.provider);
  assert.equal(first.model, metadata.model);
});

test("represents provider failures without pretending an embedding exists", () => {
  const result: TranscriptEmbeddingResult = {
    status: "failed",
    identity: createTranscriptEmbeddingIdentity("video-1", 0),
    error: { code: "provider-failure", message: "Embedding provider unavailable", retryable: true },
  };
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "provider-failure");
});

test("validates vector dimensions", () => {
  assert.throws(() => validateTranscriptEmbeddingDimension([0.1, 0.2], 3), /dimension mismatch: expected 3, received 2/);
  assert.doesNotThrow(() => validateTranscriptEmbeddingDimension([0.1, 0.2], 2));
  assert.throws(() => validateTranscriptEmbeddingOutput({ ...output("video-1", 0, 0), dimension: 2 }), /dimension mismatch/);
});

test("derives output identity and retains source order and provider/model metadata", () => {
  const record = output("video-1", 0, 3);
  assert.equal(record.identity, createTranscriptEmbeddingIdentity("video-1", 0));
  assert.equal(record.dimension, 1);
  assert.equal(record.order, 3);
  assert.equal(record.provider, metadata.provider);
  assert.equal(record.model, metadata.model);
  assert.doesNotThrow(() => validateTranscriptEmbeddingOutput(record));
});

test("rejects an output whose identity does not match its source chunk", () => {
  assert.throws(() => validateTranscriptEmbeddingOutput({ ...output("video-1", 0, 0), identity: createTranscriptEmbeddingIdentity("video-2", 0) }), /identity does not match/);
});

test("re-indexing replaces by identity and retains replacement source order", () => {
  const replacement = output("video-1", 0, 7, [0.9]);
  const other = output("video-1", 1, 2);
  assert.deepEqual(replaceTranscriptEmbeddings([output("video-1", 0, 0), other], [replacement]), [replacement, other]);
});

test("rejects repeated replacement identities instead of silently choosing one", () => {
  assert.throws(() => replaceTranscriptEmbeddings([], [output("video-1", 0, 0), output("video-1", 0, 1, [0.9])]), /Duplicate transcript embedding identity/);
});

test("rejects incompatible dimensions, providers, and models in replacement batches", () => {
  const first = output("video-1", 0, 0);
  const second = output("video-1", 1, 1);
  assert.throws(() => replaceTranscriptEmbeddings([], [first, output("video-1", 1, 1, [0.1, 0.2])]), /incompatible dimensions/);
  assert.throws(() => replaceTranscriptEmbeddings([first], [{ ...first, provider: "provider-b" }]), /incompatible provider\/model/);
  assert.throws(() => replaceTranscriptEmbeddings([], [first, { ...second, model: "model-b" }]), /incompatible provider\/model/);
  assert.deepEqual(replaceTranscriptEmbeddings([first], [second]), [first, second]);
});

test("treats an empty replacement batch as a no-op", () => {
  const existing = [output("video-1", 0, 0)];
  assert.strictEqual(replaceTranscriptEmbeddings(existing, []), existing);
});
