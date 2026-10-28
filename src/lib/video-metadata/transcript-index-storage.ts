import { asc, eq } from "drizzle-orm";
import { db, transcriptIndexEntries } from "@/lib/db";
import type { TranscriptIndexEntry } from "./transcript-index";

export type TranscriptIndexStorage = {
  replaceAll(videoId: string, entries: readonly TranscriptIndexEntry[]): Promise<void>;
  list(videoId: string): Promise<TranscriptIndexEntry[]>;
  deleteByVideo(videoId: string): Promise<void>;
};

export function createTranscriptIndexStorage(): TranscriptIndexStorage {
  return {
    async replaceAll(videoId, entries) {
      for (const entry of entries) {
        if (entry.videoId !== videoId) {
          throw new Error("All transcript index entries must belong to the replaced video");
        }
      }

      await db.transaction(async (transaction) => {
        await transaction
          .delete(transcriptIndexEntries)
          .where(eq(transcriptIndexEntries.videoId, videoId));

        if (entries.length === 0) return;

        await transaction.insert(transcriptIndexEntries).values(
          entries.map((entry) => ({
            videoId: entry.videoId,
            chunkIndex: entry.chunkIndex,
            text: entry.text,
            identity: entry.identity,
            order: entry.order,
          }))
        );
      });
    },

    async list(videoId) {
      const rows = await db
        .select()
        .from(transcriptIndexEntries)
        .where(eq(transcriptIndexEntries.videoId, videoId))
        .orderBy(asc(transcriptIndexEntries.order), asc(transcriptIndexEntries.id));

      return rows.map((row) => ({
        videoId: row.videoId,
        chunkIndex: row.chunkIndex,
        text: row.text,
        identity: row.identity,
        order: row.order,
      }));
    },

    async deleteByVideo(videoId) {
      await db
        .delete(transcriptIndexEntries)
        .where(eq(transcriptIndexEntries.videoId, videoId));
    },
  };
}
