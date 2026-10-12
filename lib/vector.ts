import { Index } from "@upstash/vector";
import { createOpenAI } from "@ai-sdk/openai";
import { embed, embedMany } from "ai";

export type ChunkMetadata = {
  source: string;
  page: number;
  section: string;
  text: string;
};

export type Source = {
  id: string;
  score: number;
  source: string;
  page: number;
  section: string;
  snippet: string;
};

// Created lazily so the module can be imported at build time without env vars.
let cached: Index<ChunkMetadata> | null = null;

export function getIndex(): Index<ChunkMetadata> {
  if (cached) return cached;
  const url = process.env.UPSTASH_VECTOR_REST_URL;
  const token = process.env.UPSTASH_VECTOR_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "Missing UPSTASH_VECTOR_REST_URL or UPSTASH_VECTOR_REST_TOKEN"
    );
  }
  cached = new Index<ChunkMetadata>({ url, token });
  return cached;
}

// Built per call so scripts that load .env.local after imports still work.
function embeddingModel() {
  const openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
  });
  return openai.textEmbeddingModel(
    process.env.EMBEDDING_MODEL ?? "text-embedding-3-small"
  );
}

export async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embed({ model: embeddingModel(), value: text });
  return embedding;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const { embeddings } = await embedMany({
    model: embeddingModel(),
    values: texts,
  });
  return embeddings;
}

export const TOP_K = Number(process.env.RAG_TOP_K ?? 5);

/** Semantic search over the corpus: embed the query, then query Upstash. */
export async function searchCorpus(query: string): Promise<Source[]> {
  const vector = await embedText(query);
  const results = await getIndex().query({
    vector,
    topK: TOP_K,
    includeMetadata: true,
  });

  return results
    .filter((r) => r.metadata)
    .map((r) => {
      const m = r.metadata as ChunkMetadata;
      return {
        id: String(r.id),
        score: Number(r.score.toFixed(3)),
        source: m.source,
        page: m.page,
        section: m.section,
        snippet: m.text.length > 700 ? m.text.slice(0, 700) + "…" : m.text,
      };
    });
}
