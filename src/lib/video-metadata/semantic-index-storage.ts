import { and, asc, eq, sql } from "drizzle-orm";
import {
  db,
  semanticIndexChunks,
  semanticIndexDocuments,
  semanticIndexUsage,
} from "@/lib/db";
import type { TranscriptIndexEntry } from "./transcript-index";

export type SemanticIndexScope = {
  userId: string;
  channelId: string;
};

export type SemanticIndexRequest = {
  scope: SemanticIndexScope;
  videoId: string;
  operationId: string;
  chunkingVersion: string;
  sourceRevision: string;
  entries: readonly TranscriptIndexEntry[];
};

export type SemanticIndexStatus = {
  documentId: number;
  scope: SemanticIndexScope;
  videoId: string;
  chunkingVersion: string;
  sourceRevision: string;
  status: "indexed";
  chunkCount: number;
  characterCount: number;
  createdAt: string;
  updatedAt: string;
};

export type SemanticIndexUsageSummary = {
  bucketStart: string;
  operationCount: number;
  chunkCount: number;
  characterCount: number;
};

export type SemanticIndexStorageOptions = {
  maxChunksPerBucket?: number;
  maxCharactersPerBucket?: number;
  now?: () => Date;
};

export class SemanticIndexValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SemanticIndexValidationError";
  }
}

export class SemanticIndexUsageLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SemanticIndexUsageLimitError";
  }
}

export const SEMANTIC_INDEX_CHUNKING_VERSION = "transcript-v1" as const;

const DEFAULT_MAX_CHUNKS_PER_BUCKET = 10_000;
const DEFAULT_MAX_CHARACTERS_PER_BUCKET = 2_000_000;

function requireText(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SemanticIndexValidationError(`${field} must not be empty`);
  }
  return value;
}

function chunkIdentity(videoId: string, chunkIndex: number): string {
  return JSON.stringify(["transcript-chunk", videoId, chunkIndex]);
}

function validateRequest(request: SemanticIndexRequest): void {
  requireText(request.scope.userId, "userId");
  requireText(request.scope.channelId, "channelId");
  requireText(request.videoId, "videoId");
  requireText(request.operationId, "operationId");
  requireText(request.chunkingVersion, "chunkingVersion");
  if (request.chunkingVersion !== SEMANTIC_INDEX_CHUNKING_VERSION) {
    throw new SemanticIndexValidationError(
      `Unsupported semantic index chunking version: ${request.chunkingVersion}`,
    );
  }
  requireText(request.sourceRevision, "sourceRevision");

  const seenIdentities = new Set<string>();
  for (const entry of request.entries) {
    if (entry.videoId !== request.videoId) {
      throw new SemanticIndexValidationError(
        "All semantic index entries must belong to the requested video",
      );
    }
    if (!Number.isInteger(entry.chunkIndex) || entry.chunkIndex < 0) {
      throw new SemanticIndexValidationError(
        "Semantic index chunk index must be a non-negative integer",
      );
    }
    if (!Number.isInteger(entry.order) || entry.order < 0) {
      throw new SemanticIndexValidationError(
        "Semantic index entry order must be a non-negative integer",
      );
    }
    if (entry.text.trim().length === 0) {
      throw new SemanticIndexValidationError("Semantic index chunk text must not be empty");
    }
    if (entry.identity !== chunkIdentity(entry.videoId, entry.chunkIndex)) {
      throw new SemanticIndexValidationError(
        "Semantic index identity does not match its source chunk",
      );
    }
    if (seenIdentities.has(entry.identity)) {
      throw new SemanticIndexValidationError(
        `Duplicate semantic index identity: ${entry.identity}`,
      );
    }
    seenIdentities.add(entry.identity);
  }
}

function bucketStart(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function scopeWhere(scope: SemanticIndexScope) {
  return and(
    eq(semanticIndexDocuments.userId, scope.userId),
    eq(semanticIndexDocuments.channelId, scope.channelId),
  );
}

function chunkScopeWhere(scope: SemanticIndexScope, videoId: string) {
  return and(
    eq(semanticIndexChunks.userId, scope.userId),
    eq(semanticIndexChunks.channelId, scope.channelId),
    eq(semanticIndexChunks.videoId, videoId),
  );
}

function usageScopeWhere(scope: SemanticIndexScope, day: string) {
  return and(
    eq(semanticIndexUsage.userId, scope.userId),
    eq(semanticIndexUsage.channelId, scope.channelId),
    eq(semanticIndexUsage.bucketStart, day),
  );
}

type SemanticIndexQueryExecutor = Pick<typeof db, "select">;

async function readStatus(
  executor: SemanticIndexQueryExecutor,
  scope: SemanticIndexScope,
  videoId: string,
): Promise<SemanticIndexStatus | null> {
  const [document] = await executor
    .select()
    .from(semanticIndexDocuments)
    .where(and(scopeWhere(scope), eq(semanticIndexDocuments.videoId, videoId)));

  if (!document) return null;
  return {
    documentId: document.id,
    scope,
    videoId: document.videoId,
    chunkingVersion: document.chunkingVersion,
    sourceRevision: document.sourceRevision,
    status: "indexed",
    chunkCount: document.chunkCount,
    characterCount: document.characterCount,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export function createSemanticIndexStorage(options: SemanticIndexStorageOptions = {}) {
  const maxChunksPerBucket = options.maxChunksPerBucket ?? DEFAULT_MAX_CHUNKS_PER_BUCKET;
  const maxCharactersPerBucket =
    options.maxCharactersPerBucket ?? DEFAULT_MAX_CHARACTERS_PER_BUCKET;
  const now = options.now ?? (() => new Date());

  if (!Number.isInteger(maxChunksPerBucket) || maxChunksPerBucket <= 0) {
    throw new SemanticIndexValidationError("maxChunksPerBucket must be a positive integer");
  }
  if (!Number.isInteger(maxCharactersPerBucket) || maxCharactersPerBucket <= 0) {
    throw new SemanticIndexValidationError(
      "maxCharactersPerBucket must be a positive integer",
    );
  }

  return {
    async replace(request: SemanticIndexRequest): Promise<SemanticIndexStatus> {
      validateRequest(request);
      const timestamp = now().toISOString();
      const day = bucketStart(new Date(timestamp));
      const characterCount = request.entries.reduce((total, entry) => total + entry.text.length, 0);

      return db.transaction(async (transaction) => {
        const [existingOperation] = await transaction
          .select()
          .from(semanticIndexUsage)
          .where(
            and(
              eq(semanticIndexUsage.userId, request.scope.userId),
              eq(semanticIndexUsage.channelId, request.scope.channelId),
              eq(semanticIndexUsage.operationId, request.operationId),
            ),
          );

        if (existingOperation) {
          if (existingOperation.videoId !== request.videoId) {
            throw new SemanticIndexValidationError(
              "Semantic index operationId cannot be reused for another video",
            );
          }
          const existingStatus = await readStatus(transaction, request.scope, request.videoId);
          if (!existingStatus) {
            throw new SemanticIndexValidationError(
              "Semantic index operation is recorded without an indexed document",
            );
          }
          return existingStatus;
        }

        const [usage] = await transaction
          .select({
            chunkCount: sql<number>`coalesce(sum(${semanticIndexUsage.chunkCount}), 0)`,
            characterCount: sql<number>`coalesce(sum(${semanticIndexUsage.characterCount}), 0)`,
          })
          .from(semanticIndexUsage)
          .where(usageScopeWhere(request.scope, day));
        const usedChunks = Number(usage?.chunkCount ?? 0);
        const usedCharacters = Number(usage?.characterCount ?? 0);

        if (
          usedChunks + request.entries.length > maxChunksPerBucket ||
          usedCharacters + characterCount > maxCharactersPerBucket
        ) {
          throw new SemanticIndexUsageLimitError(
            "Semantic indexing usage limit exceeded; no data was changed",
          );
        }

        const [existingDocument] = await transaction
          .select({ id: semanticIndexDocuments.id })
          .from(semanticIndexDocuments)
          .where(and(scopeWhere(request.scope), eq(semanticIndexDocuments.videoId, request.videoId)));
        if (existingDocument) {
          await transaction.delete(semanticIndexChunks).where(
            and(
              eq(semanticIndexChunks.documentId, existingDocument.id),
              eq(semanticIndexChunks.userId, request.scope.userId),
              eq(semanticIndexChunks.channelId, request.scope.channelId),
            ),
          );
          await transaction
            .delete(semanticIndexDocuments)
            .where(eq(semanticIndexDocuments.id, existingDocument.id));
        }

        const [document] = await transaction
          .insert(semanticIndexDocuments)
          .values({
            userId: request.scope.userId,
            channelId: request.scope.channelId,
            videoId: request.videoId,
            chunkingVersion: request.chunkingVersion,
            sourceRevision: request.sourceRevision,
            status: "indexed",
            chunkCount: request.entries.length,
            characterCount,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .returning({ id: semanticIndexDocuments.id });
        if (!document) throw new Error("Semantic index document was not created");

        if (request.entries.length > 0) {
          await transaction.insert(semanticIndexChunks).values(
            request.entries.map((entry) => ({
              documentId: document.id,
              userId: request.scope.userId,
              channelId: request.scope.channelId,
              videoId: request.videoId,
              chunkIndex: entry.chunkIndex,
              text: entry.text,
              identity: entry.identity,
              order: entry.order,
            })),
          );
        }

        await transaction.insert(semanticIndexUsage).values({
          userId: request.scope.userId,
          channelId: request.scope.channelId,
          operationId: request.operationId,
          videoId: request.videoId,
          bucketStart: day,
          chunkCount: request.entries.length,
          characterCount,
          timestamp,
        });

        return {
          documentId: document.id,
          scope: request.scope,
          videoId: request.videoId,
          chunkingVersion: request.chunkingVersion,
          sourceRevision: request.sourceRevision,
          status: "indexed" as const,
          chunkCount: request.entries.length,
          characterCount,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
      });
    },

    async list(scope: SemanticIndexScope, videoId: string): Promise<TranscriptIndexEntry[]> {
      requireText(scope.userId, "userId");
      requireText(scope.channelId, "channelId");
      requireText(videoId, "videoId");
      return db
        .select({
          videoId: semanticIndexChunks.videoId,
          chunkIndex: semanticIndexChunks.chunkIndex,
          text: semanticIndexChunks.text,
          identity: semanticIndexChunks.identity,
          order: semanticIndexChunks.order,
        })
        .from(semanticIndexChunks)
        .where(chunkScopeWhere(scope, videoId))
        .orderBy(asc(semanticIndexChunks.order), asc(semanticIndexChunks.id));
    },

    async status(scope: SemanticIndexScope, videoId: string): Promise<SemanticIndexStatus | null> {
      requireText(scope.userId, "userId");
      requireText(scope.channelId, "channelId");
      requireText(videoId, "videoId");
      return readStatus(db, scope, videoId);
    },

    async delete(scope: SemanticIndexScope, videoId: string): Promise<void> {
      requireText(scope.userId, "userId");
      requireText(scope.channelId, "channelId");
      requireText(videoId, "videoId");
      await db.transaction(async (transaction) => {
        const status = await readStatus(transaction, scope, videoId);
        if (!status) return;
        await transaction.delete(semanticIndexChunks).where(chunkScopeWhere(scope, videoId));
        await transaction
          .delete(semanticIndexDocuments)
          .where(eq(semanticIndexDocuments.id, status.documentId));
      });
    },

    async usage(scope: SemanticIndexScope): Promise<SemanticIndexUsageSummary> {
      requireText(scope.userId, "userId");
      requireText(scope.channelId, "channelId");
      const day = bucketStart(now());
      const [summary] = await db
        .select({
          operationCount: sql<number>`count(*)`,
          chunkCount: sql<number>`coalesce(sum(${semanticIndexUsage.chunkCount}), 0)`,
          characterCount: sql<number>`coalesce(sum(${semanticIndexUsage.characterCount}), 0)`,
        })
        .from(semanticIndexUsage)
        .where(usageScopeWhere(scope, day));
      return {
        bucketStart: day,
        operationCount: Number(summary?.operationCount ?? 0),
        chunkCount: Number(summary?.chunkCount ?? 0),
        characterCount: Number(summary?.characterCount ?? 0),
      };
    },
  };
}
