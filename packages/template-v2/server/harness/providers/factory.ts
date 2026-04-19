/**
 * Resolve LLM provider endpoints via a single `BIFROST_API_KEY` toggle:
 * when set, all calls route through the Bifrost gateway with provider-prefixed
 * model IDs ('anthropic/claude-sonnet-4-6'); when unset, each provider's
 * OpenAI-compatible endpoint is used with the matching API key env.
 */

/** OpenAI-compatible endpoints for each provider in local-dev mode. */
const PROVIDER_ENDPOINTS: Record<string, { baseURL: string; apiKeyEnv: string }> = {
  gemini: {
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    apiKeyEnv: 'GOOGLE_GENERATIVE_AI_API_KEY',
  },
  anthropic: {
    baseURL: 'https://api.anthropic.com/v1/',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
  },
  openai: {
    baseURL: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
  },
}

export interface ResolvedEndpoint {
  /** Base URL for the OpenAI-compatible API. */
  baseURL: string
  /** API key to use for Authorization header. */
  apiKey: string
  /**
   * Model ID to pass to the provider:
   * - Bifrost mode: keeps the full `provider/model` prefix for routing.
   * - Direct mode: prefix stripped (e.g. 'claude-sonnet-4-6').
   */
  resolvedModelId: string
}

/** Cache base config per mode so HTTP keep-alive pools are shared across agents. */
const endpointConfigCache = new Map<string, { baseURL: string; apiKey: string }>()

/**
 * Resolve which endpoint + API key + model ID to use for a given model slug.
 * Single `BIFROST_API_KEY` env toggle picks between gateway (production) and
 * per-provider direct access (local dev). Cached per-mode.
 *
 * @param modelId - Provider-prefixed model ID (e.g. 'anthropic/claude-sonnet-4-6').
 */
export function resolveProviderEndpoint(modelId: string): ResolvedEndpoint {
  const bifrostKey = process.env.BIFROST_API_KEY

  if (bifrostKey) {
    const cacheKey = 'bifrost'
    if (!endpointConfigCache.has(cacheKey)) {
      endpointConfigCache.set(cacheKey, {
        baseURL: process.env.BIFROST_URL ?? '',
        apiKey: bifrostKey,
      })
    }
    const cfg = endpointConfigCache.get(cacheKey) as { baseURL: string; apiKey: string }
    // Bifrost routes by provider prefix — keep the full model ID.
    return { baseURL: cfg.baseURL, apiKey: cfg.apiKey, resolvedModelId: modelId }
  }

  const providerName = modelId.split('/')[0] ?? ''
  if (!endpointConfigCache.has(providerName)) {
    const endpoint = PROVIDER_ENDPOINTS[providerName]
    endpointConfigCache.set(providerName, {
      baseURL: endpoint?.baseURL ?? 'https://api.openai.com/v1',
      apiKey: endpoint ? (process.env[endpoint.apiKeyEnv] ?? '') : (process.env.OPENAI_API_KEY ?? ''),
    })
  }
  const cfg = endpointConfigCache.get(providerName) as { baseURL: string; apiKey: string }
  // Direct access: strip the provider prefix so the downstream API receives a bare model name.
  return { baseURL: cfg.baseURL, apiKey: cfg.apiKey, resolvedModelId: stripProvider(modelId) }
}

/** Strip 'provider/' prefix from a model ID. */
export function stripProvider(modelId: string): string {
  const slash = modelId.indexOf('/')
  return slash === -1 ? modelId : modelId.slice(slash + 1)
}

/** Clear the endpoint cache — used by tests to isolate environment state. */
export function _clearEndpointCache(): void {
  endpointConfigCache.clear()
}
