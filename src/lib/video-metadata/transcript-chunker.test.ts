import assert from "node:assert/strict";
import test from "node:test";
import { chunkTranscript } from "./transcript-chunker";

test("keeps short text as one indexed chunk", () => {
  assert.deepEqual(chunkTranscript("A short transcript."), [
    { index: 0, text: "A short transcript." },
  ]);
});

test("keeps paragraph boundaries when each paragraph fits", () => {
  assert.deepEqual(chunkTranscript("First paragraph.\n\nSecond paragraph.", { maxChars: 30 }), [
    { index: 0, text: "First paragraph." },
    { index: 1, text: "Second paragraph." },
  ]);
});

test("does not split text at an exact maximum boundary", () => {
  assert.deepEqual(chunkTranscript("12345\n\n67890", { maxChars: 5 }), [
    { index: 0, text: "12345" },
    { index: 1, text: "67890" },
  ]);
});

test("uses line boundaries before hard splitting an oversized paragraph", () => {
  assert.deepEqual(
    chunkTranscript("One line\nTwo line\nThree line", { maxChars: 10 }),
    [
      { index: 0, text: "One line" },
      { index: 1, text: "Two line" },
      { index: 2, text: "Three line" },
    ]
  );
});

test("hard-splits an oversized line without overlap", () => {
  assert.deepEqual(chunkTranscript("abcdefghij", { maxChars: 4 }), [
    { index: 0, text: "abcd" },
    { index: 1, text: "efgh" },
    { index: 2, text: "ij" },
  ]);
});

test("returns no chunks for empty or whitespace-only input", () => {
  assert.deepEqual(chunkTranscript(""), []);
  assert.deepEqual(chunkTranscript(" \n\t  "), []);
});

test("is deterministic and preserves content once without overlap", () => {
  const input = "Alpha\n\nBeta\nGamma";
  const first = chunkTranscript(input, { maxChars: 6 });
  const second = chunkTranscript(input, { maxChars: 6 });

  assert.deepEqual(first, second);
  assert.equal(first.map((chunk) => chunk.text).join("\n"), "Alpha\nBeta\nGamma");
  assert.deepEqual(first.map((chunk) => chunk.index), [0, 1, 2]);
});

test("rejects non-positive or non-integer maximum sizes", () => {
  assert.throws(() => chunkTranscript("text", { maxChars: 0 }), RangeError);
  assert.throws(() => chunkTranscript("text", { maxChars: -1 }), RangeError);
  assert.throws(() => chunkTranscript("text", { maxChars: 1.5 }), RangeError);
});
