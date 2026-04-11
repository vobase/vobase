/**
 * Centralized LLM provider factory.
 *
 * When BIFROST_API_KEY is set (production tenants), all LLM calls route through
 * the Bifrost gateway using OpenAI-compatible format with provider-prefixed model
 * names (e.g. 'openai/gpt-5.4-mini', 'anthropic/claude-sonnet-4-6').
 *
 * When unset (local dev), falls back to direct provider API keys.
 */
import { createOpenAI } from '@ai-sdk/openai';

/**
 * Create an AI SDK OpenAI-compatible provider.
 * Routes through Bifrost when BIFROST_API_KEY is set.
 */
export function createLLMProvider() {
  const bifrostKey = process.env.BIFROST_API_KEY;
  if (bifrostKey) {
    return createOpenAI({
      baseURL: process.env.BIFROST_URL,
      apiKey: bifrostKey,
    });
  }
  return createOpenAI();
}

/**
 * Get a chat model instance. Uses provider-prefixed names through Bifrost,
 * bare model names for direct provider access.
 *
 * @param modelId - Mastra-format model ID (e.g. 'openai/gpt-5.4-mini')
 */
export function getChatModel(modelId: string) {
  const provider = createLLMProvider();
  const isBifrost = !!process.env.BIFROST_API_KEY;
  // Bifrost routes by provider prefix; direct access uses bare model names
  return provider(isBifrost ? modelId : stripProvider(modelId));
}

/**
 * Get an embedding model instance.
 *
 * @param modelId - Mastra-format model ID (e.g. 'openai/text-embedding-3-small')
 */
export function getEmbeddingModel(modelId: string) {
  const provider = createLLMProvider();
  const isBifrost = !!process.env.BIFROST_API_KEY;
  return provider.embedding(isBifrost ? modelId : stripProvider(modelId));
}

/**
 * Build a Mastra-compatible model config for agents.
 * Returns an OpenAICompatibleConfig for Bifrost, or the raw string for local dev.
 */
export function agentModel(modelId: `${string}/${string}`) {
  const bifrostKey = process.env.BIFROST_API_KEY;
  if (bifrostKey) {
    return {
      id: modelId,
      url: process.env.BIFROST_URL,
      apiKey: bifrostKey,
    };
  }
  return modelId;
}

/** Strip 'provider/' prefix from a model ID. */
function stripProvider(modelId: string): string {
  const slash = modelId.indexOf('/');
  return slash === -1 ? modelId : modelId.slice(slash + 1);
}
