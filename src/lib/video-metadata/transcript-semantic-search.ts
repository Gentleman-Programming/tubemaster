import {
  validateTranscriptEmbeddingDimension,
  validateTranscriptEmbeddingOutput,
  type TranscriptEmbeddingOutput,
} from "./transcript-embedding";

export type TranscriptSemanticSearchQuery = {
  readonly vector: readonly number[];
  readonly provider: string;
  readonly model: string;
};

export type TranscriptSemanticSearchCandidate = {
  readonly embedding: TranscriptEmbeddingOutput;
  readonly text: string;
};

export type TranscriptSemanticSearchOptions = {
  readonly videoId?: string;
  readonly minimumScore?: number;
  readonly limit?: number;
};

export type TranscriptSemanticSearchResult = {
  readonly identity: string;
  readonly videoId: string;
  readonly chunkIndex: number;
  readonly text: string;
  readonly order: number;
  readonly score: number;
  readonly provider: string;
  readonly model: string;
  readonly dimension: number;
};

function assertMetadata(value: string, label: string): void {
  if (!value.trim()) throw new RangeError(`Embedding ${label} must not be empty`);
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] as number;
    const rightValue = right[index] as number;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (rightMagnitude === 0) return 0;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function compareResults(
  left: TranscriptSemanticSearchResult,
  right: TranscriptSemanticSearchResult
): number {
  if (left.score !== right.score) return right.score - left.score;
  if (left.order !== right.order) return left.order - right.order;
  return left.identity.localeCompare(right.identity);
}

export function searchTranscriptEmbeddings(
  query: TranscriptSemanticSearchQuery,
  candidates: readonly TranscriptSemanticSearchCandidate[],
  options: TranscriptSemanticSearchOptions = {}
): TranscriptSemanticSearchResult[] {
  assertMetadata(query.provider, "provider");
  assertMetadata(query.model, "model");
  validateTranscriptEmbeddingDimension(query.vector, query.vector.length);

  if (query.vector.every((value) => value === 0)) {
    throw new RangeError("Embedding query vector must not be all zero");
  }

  if (options.videoId !== undefined && !options.videoId.trim()) {
    throw new RangeError("Transcript search video ID must not be empty");
  }
  if (
    options.minimumScore !== undefined &&
    (!Number.isFinite(options.minimumScore) || options.minimumScore < -1 || options.minimumScore > 1)
  ) {
    throw new RangeError("Transcript search minimum score must be between -1 and 1");
  }
  if (
    options.limit !== undefined &&
    (!Number.isInteger(options.limit) || options.limit <= 0)
  ) {
    throw new RangeError("Transcript search limit must be a positive integer");
  }

  const seenIdentities = new Set<string>();
  const results: TranscriptSemanticSearchResult[] = [];

  for (const candidate of candidates) {
    validateTranscriptEmbeddingOutput(candidate.embedding);
    if (!candidate.text.trim()) {
      throw new RangeError("Transcript search candidate text must not be empty");
    }
    if (candidate.embedding.dimension !== query.vector.length) {
      throw new RangeError(
        `Embedding vector dimension mismatch: expected ${query.vector.length}, received ${candidate.embedding.dimension}`
      );
    }
    if (
      candidate.embedding.provider !== query.provider ||
      candidate.embedding.model !== query.model
    ) {
      throw new RangeError("Transcript search contains incompatible provider/model metadata");
    }
    if (seenIdentities.has(candidate.embedding.identity)) {
      throw new RangeError(`Duplicate transcript search identity: ${candidate.embedding.identity}`);
    }
    seenIdentities.add(candidate.embedding.identity);

    if (options.videoId !== undefined && candidate.embedding.videoId !== options.videoId) {
      continue;
    }

    const score = cosineSimilarity(query.vector, candidate.embedding.vector);
    if (options.minimumScore !== undefined && score < options.minimumScore) continue;

    results.push({
      identity: candidate.embedding.identity,
      videoId: candidate.embedding.videoId,
      chunkIndex: candidate.embedding.chunkIndex,
      text: candidate.text,
      order: candidate.embedding.order,
      score: Object.is(score, -0) ? 0 : score,
      provider: candidate.embedding.provider,
      model: candidate.embedding.model,
      dimension: candidate.embedding.dimension,
    });
  }

  results.sort(compareResults);
  return options.limit === undefined ? results : results.slice(0, options.limit);
}
