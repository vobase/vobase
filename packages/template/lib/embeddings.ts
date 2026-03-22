import { openai } from '@ai-sdk/openai';
import { embed, embedMany } from 'ai';

import {
  bareModelName,
  EMBEDDING_DIMENSIONS,
  models,
} from '../mastra/lib/models';

const embeddingModel = openai.embedding(bareModelName(models.gpt_embedding));

/**
 * Embed multiple text chunks. Returns float arrays.
 */
export async function embedChunks(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { embeddings } = await embedMany({
    model: embeddingModel,
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
    model: embeddingModel,
    value: query,
    providerOptions: { openai: { dimensions: EMBEDDING_DIMENSIONS } },
  });
  return embedding;
}
