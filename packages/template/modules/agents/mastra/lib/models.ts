/**
 * Pre-defined model aliases for AI agents and tools.
 * Values are in Mastra's provider/model format.
 *
 * To add a new model, add it here and use it directly in agent definitions.
 */
export const models = {
  gpt_embedding: 'openai/text-embedding-3-small',
  gpt_mini: 'openai/gpt-5.4-mini',
  gpt_standard: 'openai/gpt-5.4',
  claude_haiku: 'anthropic/claude-haiku-4-5',
  claude_sonnet: 'anthropic/claude-sonnet-4-6',
  gemini_flash: 'gemini/gemini-3-flash-preview',
  gemini_pro: 'gemini/gemini-3.1-pro-preview',
} as const;

/** Embedding dimensions for text-embedding-3-small. */
export const EMBEDDING_DIMENSIONS = 1536;
