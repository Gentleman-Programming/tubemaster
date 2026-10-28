/**
 * A deliberately internal chunk shape: order and text are all callers need.
 */
export interface TranscriptChunk {
  index: number;
  text: string;
}

export interface TranscriptChunkOptions {
  maxChars?: number;
}

const DEFAULT_MAX_CHARS = 2_000;

/**
 * Split already-normalized transcript text without provider-specific parsing.
 *
 * Policy:
 * - The limit is a JavaScript-character maximum and every emitted chunk stays
 *   at or below it.
 * - Outer whitespace is ignored for empty-input handling and removed from the
 *   first/last boundary; internal whitespace is preserved.
 * - Non-oversized paragraphs remain separate. An oversized paragraph is first
 *   split at line boundaries, then an oversized line is split by characters.
 * - Chunks never overlap and retain source order. Blank sections emit nothing.
 */
export function chunkTranscript(
  text: string,
  options: TranscriptChunkOptions = {}
): TranscriptChunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;

  if (!Number.isInteger(maxChars) || maxChars <= 0) {
    throw new RangeError("maxChars must be a positive integer");
  }

  const trimmedText = text.trim();
  if (trimmedText.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  const paragraphs = trimmedText.split(/\n[ \t]*\n+/);

  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) {
      continue;
    }

    if (paragraph.length <= maxChars) {
      chunks.push(paragraph);
      continue;
    }

    for (const line of paragraph.split("\n")) {
      if (line.length === 0) {
        continue;
      }

      if (line.length <= maxChars) {
        chunks.push(line);
        continue;
      }

      for (let start = 0; start < line.length; start += maxChars) {
        chunks.push(line.slice(start, start + maxChars));
      }
    }
  }

  return chunks.map((chunk, index) => ({ index, text: chunk }));
}
