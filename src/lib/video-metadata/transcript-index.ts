import type { TranscriptChunk } from "./transcript-chunker";

/** A chunk retained by the in-memory transcript index. */
export interface TranscriptIndexEntry {
  videoId: string;
  chunkIndex: number;
  text: string;
  identity: string;
  order: number;
}

/**
 * Build a deterministic, storage-neutral index without deduplicating input.
 *
 * Identity is the JSON representation of ["transcript-chunk", videoId,
 * chunkIndex]. Keeping the video ID as a separate encoded value prevents
 * collisions between video IDs that contain separators. Duplicate input
 * therefore produces duplicate entries with the same source identity, while
 * `order` preserves each occurrence's input position.
 */
export function buildTranscriptIndex(
  videoId: string,
  chunks: readonly TranscriptChunk[]
): TranscriptIndexEntry[] {
  return chunks.map((chunk, order) => ({
    videoId,
    chunkIndex: chunk.index,
    text: chunk.text,
    identity: JSON.stringify(["transcript-chunk", videoId, chunk.index]),
    order,
  }));
}
