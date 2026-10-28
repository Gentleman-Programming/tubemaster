import {
  createTranscriptEmbeddingOutput,
  type TranscriptEmbeddingInput,
  type TranscriptEmbeddingOutput,
} from "./transcript-embedding";

export const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
export const OPENAI_EMBEDDING_PROVIDER = "openai";

type OpenAIEmbeddingResponse = {
  model?: unknown;
  data?: Array<{ index?: unknown; embedding?: unknown }>;
};

type OpenAIEmbeddingProviderOptions = {
  apiKey?: string;
  model?: string;
  fetcher?: typeof fetch;
};

function configuredModel(model?: string) {
  const value = model ?? process.env.OPENAI_EMBEDDING_MODEL ?? DEFAULT_OPENAI_EMBEDDING_MODEL;
  if (!value.trim()) throw new Error("OpenAI embedding model is not configured");
  return value;
}

async function requestEmbeddings(
  texts: readonly string[],
  options: Required<Pick<OpenAIEmbeddingProviderOptions, "apiKey" | "model" | "fetcher">>,
): Promise<{ model: string; vectors: number[][] }> {
  if (!options.apiKey.trim()) throw new Error("OpenAI embeddings are not configured");
  if (texts.length === 0) return { model: options.model, vectors: [] };

  const response = await options.fetcher("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: options.model, input: texts, encoding_format: "float" }),
  });
  if (!response.ok) throw new Error(`OpenAI embeddings request failed (${response.status})`);

  const payload = (await response.json()) as OpenAIEmbeddingResponse;
  const model = typeof payload.model === "string" ? payload.model : options.model;
  const rows = payload.data ?? [];
  if (rows.length !== texts.length) throw new Error("OpenAI returned an incomplete embeddings response");

  const vectors = rows
    .slice()
    .sort((left, right) => Number(left.index ?? 0) - Number(right.index ?? 0))
    .map((row) => {
      if (!Array.isArray(row.embedding) || !row.embedding.every((value) => typeof value === "number")) {
        throw new Error("OpenAI returned an invalid embedding vector");
      }
      return row.embedding;
    });
  return { model, vectors };
}

export function createOpenAIEmbeddingProvider(options: OpenAIEmbeddingProviderOptions = {}) {
  const configured = {
    apiKey: options.apiKey ?? process.env.OPENAI_API_KEY ?? "",
    model: configuredModel(options.model),
    fetcher: options.fetcher ?? fetch,
  };

  return {
    provider: OPENAI_EMBEDDING_PROVIDER,
    model: configured.model,
    async embed(input: TranscriptEmbeddingInput): Promise<TranscriptEmbeddingOutput> {
      const response = await requestEmbeddings([input.text], configured);
      return createTranscriptEmbeddingOutput({
        videoId: input.videoId,
        chunkIndex: input.chunkIndex,
        vector: response.vectors[0] ?? [],
        order: input.order,
        provider: OPENAI_EMBEDDING_PROVIDER,
        model: response.model,
      });
    },

    async embedMany(inputs: readonly TranscriptEmbeddingInput[]): Promise<TranscriptEmbeddingOutput[]> {
      const response = await requestEmbeddings(inputs.map((input) => input.text), configured);
      return inputs.map((input, index) =>
        createTranscriptEmbeddingOutput({
          videoId: input.videoId,
          chunkIndex: input.chunkIndex,
          vector: response.vectors[index] ?? [],
          order: input.order,
          provider: OPENAI_EMBEDDING_PROVIDER,
          model: response.model,
        }),
      );
    },
  };
}
