import { embed, embedMany } from 'ai';

import { EMBEDDING_DIMENSIONS, models } from '../mastra/lib/models';
import { getEmbeddingModel } from '../mastra/lib/provider';

/**
 * Embed multiple text chunks. Returns float arrays.
 */
export async function embedChunks(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { embeddings } = await embedMany({
    model: getEmbeddingModel(models.gpt_embedding),
    values: texts,
    providerOptions: { openai: { dimensions: EMBEDDING_DIMENSIONS } },
  });
  return embeddings;
}

/**
 * Embed a single query string. Returns float array.
 */
export async function embedQuery(query: string): Promise<number[]> {
  const { embedding } = await embed({
    model: getEmbeddingModel(models.gpt_embedding),
    value: query,
    providerOptions: { openai: { dimensions: EMBEDDING_DIMENSIONS } },
  });
  return embedding;
}
