import assert from "node:assert/strict";
import test from "node:test";
import type { TranscriptIndexEntry } from "./transcript-index";
import {
  createSemanticIndexStorage,
  type SemanticIndexRequest,
  type SemanticIndexScope,
} from "./semantic-index-storage";

function scope(userId: string, channelId: string): SemanticIndexScope {
  return { userId, channelId };
}

function uniqueScope(prefix: string): SemanticIndexScope {
  const suffix = `${Date.now()}-${Math.random()}`;
  return scope(`${prefix}-user-${suffix}`, `${prefix}-channel-${suffix}`);
}

function entries(videoId: string, texts: readonly string[]): TranscriptIndexEntry[] {
  return texts.map((text, index) => ({
    videoId,
    chunkIndex: index,
    text,
    identity: JSON.stringify(["transcript-chunk", videoId, index]),
    order: index,
  }));
}

function request(
  scopeValue: SemanticIndexScope,
  videoId: string,
  operationId: string,
  chunkTexts: readonly string[],
  overrides: Partial<SemanticIndexRequest> = {},
): SemanticIndexRequest {
  return {
    scope: scopeValue,
    videoId,
    operationId,
    chunkingVersion: "transcript-v1",
    sourceRevision: "revision-1",
    entries: entries(videoId, chunkTexts),
    ...overrides,
  };
}

test("semantic indexing rejects invalid scope and chunk identity before writing", async () => {
  const storage = createSemanticIndexStorage();
  const invalidScope = request(scope("", "channel-a"), "video-invalid", "operation-invalid", ["text"]);

  await assert.rejects(
    storage.replace(invalidScope),
    (error: unknown) => error instanceof Error && error.name === "SemanticIndexValidationError",
  );
  assert.deepEqual(await storage.list(scope("user-a", "channel-a"), "video-invalid"), []);
});

test("semantic indexing rejects unsupported chunking versions", async () => {
  const storage = createSemanticIndexStorage();
  await assert.rejects(
    storage.replace(
      request(uniqueScope("version"), "version-video", "operation-version", ["text"], {
        chunkingVersion: "future-version",
      }),
    ),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "SemanticIndexValidationError" &&
      error.message === "Unsupported semantic index chunking version: future-version",
  );
});

test("semantic indexing isolates identical videos by user and channel", async () => {
  const storage = createSemanticIndexStorage();
  const firstScope = uniqueScope("isolation-a");
  const secondScope = uniqueScope("isolation-b");
  const videoId = "shared-video";

  await storage.replace(request(firstScope, videoId, "operation-a", ["first scope"]));
  await storage.replace(request(secondScope, videoId, "operation-b", ["second scope"]));

  assert.deepEqual(
    (await storage.list(firstScope, videoId)).map((entry) => entry.text),
    ["first scope"],
  );
  assert.deepEqual(
    (await storage.list(secondScope, videoId)).map((entry) => entry.text),
    ["second scope"],
  );

  await storage.delete(firstScope, videoId);
  assert.deepEqual(await storage.list(firstScope, videoId), []);
  assert.deepEqual(
    (await storage.list(secondScope, videoId)).map((entry) => entry.text),
    ["second scope"],
  );
});

test("semantic indexing replaces stale chunks transactionally and is idempotent by operation", async () => {
  const storage = createSemanticIndexStorage();
  const indexedScope = uniqueScope("replace");
  const videoId = "replace-video";
  const first = request(indexedScope, videoId, "operation-replace-1", ["old", "stale"]);
  const replacement = request(indexedScope, videoId, "operation-replace-2", ["new"]);

  const firstResult = await storage.replace(first);
  await storage.replace(replacement);
  const repeatedResult = await storage.replace(replacement);

  assert.deepEqual((await storage.list(indexedScope, videoId)).map((entry) => entry.text), ["new"]);
  assert.deepEqual(repeatedResult, await storage.status(indexedScope, videoId));
  assert.equal(firstResult.chunkCount, 2);
  assert.equal((await storage.usage(indexedScope)).operationCount, 2);
});

test("semantic indexing rejects a bounded usage overflow without partial replacement", async () => {
  const indexedScope = uniqueScope("limit");
  const storage = createSemanticIndexStorage({ maxChunksPerBucket: 2 });
  const videoId = "limit-video";

  await storage.replace(request(indexedScope, videoId, "operation-limit-1", ["kept", "kept-2"]));
  await assert.rejects(
    storage.replace(request(indexedScope, videoId, "operation-limit-2", ["must-not-write"])),
    (error: unknown) => error instanceof Error && error.name === "SemanticIndexUsageLimitError",
  );

  assert.deepEqual(
    (await storage.list(indexedScope, videoId)).map((entry) => entry.text),
    ["kept", "kept-2"],
  );
  assert.equal((await storage.usage(indexedScope)).operationCount, 1);
});

test("semantic indexing leaves stored data unchanged when replacement validation fails", async () => {
  const indexedScope = uniqueScope("validation");
  const storage = createSemanticIndexStorage();
  const videoId = "validation-video";

  await storage.replace(request(indexedScope, videoId, "operation-valid", ["retained"]));
  await assert.rejects(
    storage.replace(
      request(indexedScope, videoId, "operation-invalid", ["replacement"], {
        entries: [
          {
            videoId: "different-video",
            chunkIndex: 0,
            text: "wrong scope",
            identity: JSON.stringify(["transcript-chunk", "different-video", 0]),
            order: 0,
          },
        ],
      }),
    ),
    (error: unknown) => error instanceof Error && error.name === "SemanticIndexValidationError",
  );
  assert.deepEqual((await storage.list(indexedScope, videoId)).map((entry) => entry.text), ["retained"]);
});
