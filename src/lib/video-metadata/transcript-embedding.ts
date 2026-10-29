/**
 * Stable source identity for a transcript chunk. The identity intentionally
 * excludes text so re-indexing the same chunk replaces its previous vector.
 */
export type TranscriptEmbeddingIdentity = string & {
  readonly __brand: "TranscriptEmbeddingIdentity";
};

export function createTranscriptEmbeddingIdentity(
  videoId: string,
  chunkIndex: number
): TranscriptEmbeddingIdentity {
  if (!videoId.trim()) throw new RangeError("Transcript video ID must not be empty");
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    throw new RangeError("Transcript chunk index must be a non-negative integer");
  }
  return JSON.stringify(["transcript-chunk", videoId, chunkIndex]) as TranscriptEmbeddingIdentity;
}

export type TranscriptEmbeddingInput = {
  readonly identity: TranscriptEmbeddingIdentity;
  readonly videoId: string;
  readonly chunkIndex: number;
  readonly text: string;
  readonly order: number;
  readonly provider: string;
  readonly model: string;
};

export type TranscriptEmbeddingOutput = {
  readonly identity: TranscriptEmbeddingIdentity;
  readonly videoId: string;
  readonly chunkIndex: number;
  readonly vector: readonly number[];
  readonly dimension: number;
  readonly order: number;
  readonly provider: string;
  readonly model: string;
};

export type TranscriptEmbeddingProviderFailure = {
  readonly code: "provider-failure";
  readonly message: string;
  readonly providerCode?: string;
  readonly retryable?: boolean;
};

export type TranscriptEmbeddingResult =
  | { readonly status: "succeeded"; readonly embedding: TranscriptEmbeddingOutput }
  | {
      readonly status: "failed";
      readonly identity: string;
      readonly error: TranscriptEmbeddingProviderFailure;
    };

export type TranscriptEmbeddingProvider = {
  embed(input: TranscriptEmbeddingInput): Promise<TranscriptEmbeddingResult>;
};

export function createTranscriptEmbeddingInput(input: {
  videoId: string;
  chunkIndex: number;
  text: string;
  order: number;
  provider: string;
  model: string;
}): TranscriptEmbeddingInput {
  if (input.text.trim().length === 0) {
    throw new RangeError("Transcript chunk text must not be empty");
  }

  return {
    ...input,
    identity: createTranscriptEmbeddingIdentity(input.videoId, input.chunkIndex),
  };
}

export function createTranscriptEmbeddingOutput(input: {
  videoId: string;
  chunkIndex: number;
  vector: readonly number[];
  order: number;
  provider: string;
  model: string;
}): TranscriptEmbeddingOutput {
  validateTranscriptEmbeddingDimension(input.vector, input.vector.length);
  return {
    identity: createTranscriptEmbeddingIdentity(input.videoId, input.chunkIndex),
    videoId: input.videoId,
    chunkIndex: input.chunkIndex,
    vector: input.vector,
    dimension: input.vector.length,
    order: input.order,
    provider: input.provider,
    model: input.model,
  };
}

export function validateTranscriptEmbeddingDimension(
  vector: readonly number[],
  expectedDimension: number
): void {
  if (!Number.isInteger(expectedDimension) || expectedDimension <= 0) {
    throw new RangeError("Embedding dimension must be a positive integer");
  }

  if (vector.length !== expectedDimension) {
    throw new RangeError(
      `Embedding vector dimension mismatch: expected ${expectedDimension}, received ${vector.length}`
    );
  }

  if (vector.some((value) => !Number.isFinite(value))) {
    throw new RangeError("Embedding vector must contain only finite numbers");
  }
}

export function validateTranscriptEmbeddingOutput(
  embedding: TranscriptEmbeddingOutput
): void {
  const expectedIdentity = createTranscriptEmbeddingIdentity(embedding.videoId, embedding.chunkIndex);
  if (embedding.identity !== expectedIdentity) {
    throw new RangeError("Transcript embedding identity does not match its source chunk");
  }
  validateTranscriptEmbeddingDimension(embedding.vector, embedding.dimension);
}

/**
 * Replace vectors by source identity without creating duplicate records.
 * Existing list position is retained for replacements; newly indexed identities
 * are appended in the order supplied. Records retain their source order metadata.
 * Empty batches are a no-op.
 */
export function replaceTranscriptEmbeddings(
  existing: readonly TranscriptEmbeddingOutput[],
  replacements: readonly TranscriptEmbeddingOutput[]
): readonly TranscriptEmbeddingOutput[] {
  if (replacements.length === 0) return existing;

  const merged = new Map<string, TranscriptEmbeddingOutput>();
  const order: string[] = [];
  let batchDimension: number | undefined;
  let batchProvider: string | undefined;
  let batchModel: string | undefined;
  const validateBatch = (embedding: TranscriptEmbeddingOutput) => {
    validateTranscriptEmbeddingOutput(embedding);
    batchDimension ??= embedding.dimension;
    batchProvider ??= embedding.provider;
    batchModel ??= embedding.model;
    if (embedding.dimension !== batchDimension) {
      throw new RangeError("Transcript embedding batch contains incompatible dimensions");
    }
    if (embedding.provider !== batchProvider || embedding.model !== batchModel) {
      throw new RangeError("Transcript embedding batch contains incompatible provider/model metadata");
    }
  };

  for (const embedding of existing) {
    validateBatch(embedding);
    if (!merged.has(embedding.identity)) order.push(embedding.identity);
    merged.set(embedding.identity, embedding);
  }

  const replacementIdentities = new Set<string>();
  for (const embedding of replacements) {
    validateBatch(embedding);
    if (replacementIdentities.has(embedding.identity)) {
      throw new RangeError(`Duplicate transcript embedding identity: ${embedding.identity}`);
    }
    replacementIdentities.add(embedding.identity);
    if (!merged.has(embedding.identity)) order.push(embedding.identity);
    merged.set(embedding.identity, embedding);
  }

  return order.map((identity) => merged.get(identity) as TranscriptEmbeddingOutput);
}
