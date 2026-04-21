/**
 * LLM provider wiring for the pi-agent-core harness.
 *
 * Single toggle: when `BIFROST_API_KEY` + `BIFROST_URL` are set, all LLM
 * traffic routes through the Bifrost gateway (production). Otherwise the
 * direct OpenAI endpoint + `OPENAI_API_KEY` is used (local dev).
 *
 * pi-ai's `Model.baseUrl` is settable; we mutate a shallow copy after
 * `getModel(...)` and return it. `resolveApiKey()` is used for the
 * `StreamOptions.apiKey` field passed into pi-ai's stream functions.
 */

import { getModel, type Model } from '@mariozechner/pi-ai'

const DEFAULT_MODEL = 'gpt-5.4'
const FALLBACK_MODEL = 'gpt-5.4-mini'

export interface ProviderEnv {
  bifrostUrl: string | undefined
  bifrostKey: string | undefined
  openaiKey: string | undefined
}

function readEnv(): ProviderEnv {
  return {
    bifrostUrl: process.env.BIFROST_URL,
    bifrostKey: process.env.BIFROST_API_KEY,
    openaiKey: process.env.OPENAI_API_KEY,
  }
}

function isBifrostMode(env: ProviderEnv = readEnv()): boolean {
  return Boolean(env.bifrostKey && env.bifrostUrl)
}

/**
 * Build a pi-ai `Model` for the named OpenAI model id. In Bifrost mode the
 * returned model's `baseUrl` points at the gateway; in direct mode it keeps
 * pi-ai's default OpenAI endpoint.
 *
 * Returns a fresh object on every call — callers may mutate freely.
 */
export function createModel(modelId: string = DEFAULT_MODEL): Model<'openai-responses'> {
  const env = readEnv()
  // pi-ai's getModel returns `undefined` (no throw) for unknown ids — if the
  // agent row stored a legacy model like `claude-sonnet-4-6`, we quietly fall
  // back to the harness default so dev never surfaces "No API provider
  // registered for api: undefined".
  let base = getModel('openai', modelId as 'gpt-5.4') as unknown as Model<'openai-responses'> | undefined
  if (!base?.api) {
    base = getModel('openai', DEFAULT_MODEL as 'gpt-5.4') as unknown as Model<'openai-responses'> | undefined
  }
  if (!base?.api) {
    base = getModel('openai', FALLBACK_MODEL as 'gpt-5.4') as unknown as Model<'openai-responses'>
  }
  const model: Model<'openai-responses'> = { ...(base as Model<'openai-responses'>) }
  if (isBifrostMode(env) && env.bifrostUrl) {
    model.baseUrl = env.bifrostUrl
  }
  return model
}

/**
 * Resolve the API key appropriate for the current provider mode. Returns
 * undefined when no key is configured — pi-ai treats that as "omit the
 * Authorization header entirely", which is what we want for tests with stub
 * stream functions.
 */
export function resolveApiKey(): string | undefined {
  const env = readEnv()
  if (isBifrostMode(env)) return env.bifrostKey
  return env.openaiKey
}

export const HARNESS_DEFAULT_MODEL_ID = DEFAULT_MODEL
