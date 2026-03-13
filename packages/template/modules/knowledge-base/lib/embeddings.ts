import { embed, embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';

import { getAIConfig } from '../../../lib/ai';

function getEmbeddingModel() {
  const config = getAIConfig();
  // Default to OpenAI embeddings; users can swap this for any AI SDK provider
  return openai.embedding(config.embeddingModel);
}

/**
 * Embed multiple text chunks. Returns float arrays.
 */
export async function embedChunks(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const config = getAIConfig();
  const model = getEmbeddingModel();
  const { embeddings } = await embedMany({
    model,
    values: texts,
    providerOptions: { openai: { dimensions: config.embeddingDimensions } },
  });
  return embeddings;
}

/**
 * Embed a single query string. Returns float array.
 */
export async function embedQuery(query: string): Promise<number[]> {
  const config = getAIConfig();
  const model = getEmbeddingModel();
  const { embedding } = await embed({
    model,
    value: query,
    providerOptions: { openai: { dimensions: config.embeddingDimensions } },
  });
  return embedding;
}
