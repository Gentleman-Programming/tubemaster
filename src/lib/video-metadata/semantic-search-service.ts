import { chunkTranscript } from "./transcript-chunker";
import {
  createTranscriptEmbeddingInput,
  type TranscriptEmbeddingOutput,
} from "./transcript-embedding";
import { createOpenAIEmbeddingProvider } from "./openai-embedding-provider";
import { createTranscriptEmbeddingStorage, type TranscriptEmbeddingStorage } from "./transcript-embedding-storage";
import { searchTranscriptEmbeddings, type TranscriptSemanticSearchResult } from "./transcript-semantic-search";
import { createVideoMetadataCore } from "./index";
import type { TranscriptResult } from "./contracts";

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export type SemanticSearchService = {
  indexVideo(input: { userId: string; videoId: string }): Promise<{ videoId: string; chunkCount: number; model: string }>;
  search(input: { userId: string; query: string; limit?: number }): Promise<TranscriptSemanticSearchResult[]>;
};

type ServiceDeps = {
  getTranscript: (input: { userId: string; videoId: string }) => Promise<TranscriptResult>;
  storage: TranscriptEmbeddingStorage;
  embeddingProvider: ReturnType<typeof createOpenAIEmbeddingProvider>;
};

function assertVideoId(videoId: string) {
  if (!VIDEO_ID_PATTERN.test(videoId)) throw new RangeError("Enter a valid 11-character YouTube video ID");
}

function assertUserId(userId: string) {
  if (!userId.trim()) throw new RangeError("Authenticated user is required");
}

function assertAvailable(transcript: TranscriptResult): asserts transcript is Extract<TranscriptResult, { status: "available" }> {
  if (transcript.status === "available") return;
  if (transcript.status === "unsupported") throw new Error("This transcript provider is unsupported");
  if (transcript.reason === "no-captions") throw new Error("No captions are available for this video");
  throw new Error("The transcript is currently unavailable");
}

export function createSemanticSearchService(overrides: Partial<ServiceDeps> = {}): SemanticSearchService {
  const embeddingProvider = overrides.embeddingProvider ?? createOpenAIEmbeddingProvider();
  const deps: ServiceDeps = {
    getTranscript: overrides.getTranscript ?? (async ({ userId, videoId }) => {
      const result = await createVideoMetadataCore().getTranscript({
        videoId,
        credentialRef: { userId },
      });
      return result.transcript;
    }),
    storage: overrides.storage ?? createTranscriptEmbeddingStorage(),
    embeddingProvider,
  };

  return {
    async indexVideo({ userId, videoId }) {
      assertUserId(userId);
      assertVideoId(videoId);
      const transcript = await deps.getTranscript({ userId, videoId });
      assertAvailable(transcript);
      const chunks = chunkTranscript(transcript.text);
      const inputs = chunks.map((chunk) => createTranscriptEmbeddingInput({
        videoId,
        chunkIndex: chunk.index,
        text: chunk.text,
        order: chunk.index,
        provider: embeddingProvider.provider,
        model: embeddingProvider.model,
      }));
      const embeddings = await embeddingProvider.embedMany(inputs);
      const entries = embeddings.map((embedding: TranscriptEmbeddingOutput, index) => ({
        embedding,
        text: chunks[index]?.text ?? "",
      }));
      await deps.storage.replaceAll(userId, videoId, entries);
      return { videoId, chunkCount: entries.length, model: embeddingProvider.model };
    },

    async search({ userId, query, limit }) {
      assertUserId(userId);
      if (!query.trim()) throw new RangeError("Enter a search query");
      const queryInput = createTranscriptEmbeddingInput({
        videoId: "search-query",
        chunkIndex: 0,
        text: query,
        order: 0,
        provider: embeddingProvider.provider,
        model: embeddingProvider.model,
      });
      const queryEmbedding = await embeddingProvider.embed(queryInput);
      return searchTranscriptEmbeddings(
        {
          vector: queryEmbedding.vector,
          provider: queryEmbedding.provider,
          model: queryEmbedding.model,
        },
        await deps.storage.list(userId),
        { limit },
      );
    },
  };
}
