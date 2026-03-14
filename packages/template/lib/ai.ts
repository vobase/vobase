/**
 * AI configuration utilities.
 * Provider-agnostic via Vercel AI SDK.
 */

export interface AIConfig {
  provider: string;
  model: string;
  embeddingModel: string;
  embeddingDimensions: number;
}

const defaults: AIConfig = {
  provider: 'openai',
  model: process.env.AI_MODEL ?? 'gpt-4o-mini',
  embeddingModel: process.env.AI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
  embeddingDimensions: Number(process.env.AI_EMBEDDING_DIMENSIONS) || 1536,
};

export function getAIConfig(): AIConfig {
  return { ...defaults };
}

/**
 * Check if AI features are configured (at least one provider API key set).
 */
export function isAIConfigured(): boolean {
  return !!(
    process.env.OPENAI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.ANTHROPIC_API_KEY
  );
}
