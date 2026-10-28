import { and, asc, eq } from "drizzle-orm";
import { db, transcriptEmbeddingEntries } from "@/lib/db";
import type { TranscriptEmbeddingOutput } from "./transcript-embedding";
import type { TranscriptSemanticSearchCandidate } from "./transcript-semantic-search";

export type StoredTranscriptEmbedding = TranscriptSemanticSearchCandidate & {
  embedding: TranscriptEmbeddingOutput;
};

export type TranscriptEmbeddingStorage = {
  replaceAll(userId: string, videoId: string, entries: readonly StoredTranscriptEmbedding[]): Promise<void>;
  list(userId: string): Promise<StoredTranscriptEmbedding[]>;
};

export function createTranscriptEmbeddingStorage(): TranscriptEmbeddingStorage {
  return {
    async replaceAll(userId, videoId, entries) {
      if (!userId.trim()) throw new RangeError("Embedding user ID must not be empty");
      if (!videoId.trim()) throw new RangeError("Embedding video ID must not be empty");
      for (const entry of entries) {
        if (entry.embedding.videoId !== videoId) {
          throw new RangeError("All embeddings must belong to the replaced video");
        }
      }

      await db.transaction(async (transaction) => {
        await transaction.delete(transcriptEmbeddingEntries).where(
          and(
            eq(transcriptEmbeddingEntries.userId, userId),
            eq(transcriptEmbeddingEntries.videoId, videoId),
          ),
        );
        if (entries.length === 0) return;
        await transaction.insert(transcriptEmbeddingEntries).values(
          entries.map(({ embedding, text }) => ({
            userId,
            videoId: embedding.videoId,
            chunkIndex: embedding.chunkIndex,
            text,
            identity: embedding.identity,
            vector: JSON.stringify(embedding.vector),
            dimension: embedding.dimension,
            order: embedding.order,
            provider: embedding.provider,
            model: embedding.model,
          })),
        );
      });
    },

    async list(userId) {
      const rows = await db
        .select()
        .from(transcriptEmbeddingEntries)
        .where(eq(transcriptEmbeddingEntries.userId, userId))
        .orderBy(asc(transcriptEmbeddingEntries.order), asc(transcriptEmbeddingEntries.id));

      return rows.map((row) => {
        let vector: number[];
        try {
          const parsed: unknown = JSON.parse(row.vector);
          if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "number")) {
            throw new Error("invalid vector");
          }
          vector = parsed;
        } catch {
          throw new Error("Stored transcript embedding is invalid");
        }
        return {
          text: row.text,
          embedding: {
            identity: row.identity as TranscriptEmbeddingOutput["identity"],
            videoId: row.videoId,
            chunkIndex: row.chunkIndex,
            vector,
            dimension: row.dimension,
            order: row.order,
            provider: row.provider,
            model: row.model,
          },
        };
      });
    },
  };
}
