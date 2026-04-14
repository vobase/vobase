/**
 * Centralized LLM provider factory.
 *
 * When BIFROST_API_KEY is set (production tenants), all LLM calls route through
 * the Bifrost gateway using OpenAI-compatible format with provider-prefixed model
 * names (e.g. 'openai/gpt-5.4-mini', 'anthropic/claude-sonnet-4-6').
 *
 * When unset (local dev), routes to each provider's OpenAI-compatible endpoint
 * using the corresponding API key (GOOGLE_GENERATIVE_AI_API_KEY, ANTHROPIC_API_KEY,
 * OPENAI_API_KEY).
 */
import { createOpenAI } from '@ai-sdk/openai';

/** OpenAI-compatible endpoints for each provider (local dev). */
const PROVIDER_ENDPOINTS: Record<
  string,
  { baseURL: string; apiKeyEnv: string }
> = {
  gemini: {
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    apiKeyEnv: 'GOOGLE_GENERATIVE_AI_API_KEY',
  },
  anthropic: {
    baseURL: 'https://api.anthropic.com/v1/',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
  },
};

/**
 * Create an AI SDK OpenAI-compatible provider for a given model.
 * Bifrost: single gateway. Local dev: per-provider endpoint routing.
 */
function createProviderForModel(modelId: string) {
  const bifrostKey = process.env.BIFROST_API_KEY;
  if (bifrostKey) {
    return createOpenAI({
      baseURL: process.env.BIFROST_URL,
      apiKey: bifrostKey,
    });
  }

  // Local dev: resolve provider-specific OpenAI-compatible endpoint
  const providerName = modelId.split('/')[0];
  const endpoint = PROVIDER_ENDPOINTS[providerName];
  if (endpoint) {
    const apiKey = process.env[endpoint.apiKeyEnv];
    if (apiKey) {
      return createOpenAI({ baseURL: endpoint.baseURL, apiKey });
    }
  }

  // Fallback: default OpenAI
  return createOpenAI();
}

/**
 * Get a chat model instance. Routes through Bifrost in production,
 * or the provider's OpenAI-compatible endpoint in local dev.
 *
 * @param modelId - Provider-prefixed model ID (e.g. 'gemini/gemini-3-flash-preview')
 */
export function getChatModel(modelId: string) {
  const provider = createProviderForModel(modelId);
  const isBifrost = !!process.env.BIFROST_API_KEY;
  // Bifrost routes by provider prefix; direct access uses bare model names
  // Use .chat() to force Chat Completions API — the default provider()
  // uses the Responses API which doesn't translate cleanly through Bifrost
  return provider.chat(isBifrost ? modelId : stripProvider(modelId));
}

/**
 * Get an embedding model instance.
 *
 * @param modelId - Provider-prefixed model ID (e.g. 'openai/text-embedding-3-small')
 */
export function getEmbeddingModel(modelId: string) {
  const provider = createProviderForModel(modelId);
  const isBifrost = !!process.env.BIFROST_API_KEY;
  return provider.embedding(isBifrost ? modelId : stripProvider(modelId));
}

/**
 * Build a Mastra-compatible model config for agents.
 * Returns an AI SDK model instance for Bifrost, or the raw string for local dev
 * (Mastra resolves provider from the string).
 */
export function agentModel(modelId: `${string}/${string}`) {
  // Bifrost: return an AI SDK model instance that preserves the full
  // provider/model name (Mastra's OpenAICompatibleConfig strips the prefix)
  if (process.env.BIFROST_API_KEY) {
    return getChatModel(modelId);
  }
  // Local dev: return string for Mastra's built-in provider resolution
  return modelId;
}

/** Strip 'provider/' prefix from a model ID. */
function stripProvider(modelId: string): string {
  const slash = modelId.indexOf('/');
  return slash === -1 ? modelId : modelId.slice(slash + 1);
}
