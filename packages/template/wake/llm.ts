/**
 * LLM provider wiring + thin template-side wrapper around `@vobase/core#llmCall`.
 *
 * Provider modes (selected by env):
 *
 * - **Bifrost** (production) — `BIFROST_API_KEY` + `BIFROST_URL` set. All
 *   traffic routes through the gateway's OpenAI-compatible Responses API.
 *   We keep pi-ai's `openai-responses` Model template and overwrite its
 *   `id` with the full `{provider}/{model}` string Bifrost routes on and
 *   its `baseUrl` with the gateway.
 *
 * - **Direct** (local dev) — no Bifrost vars. Each provider talks to its
 *   own endpoint with its own key (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`
 *   / `GOOGLE_API_KEY`). We strip the `{provider}/` prefix and call
 *   pi-ai's `getModel(provider, bareId)` so the returned Model carries
 *   the native API type.
 *
 * Always pass `{provider}/{model}` ids from the `models` map below — never
 * bare ids at call sites.
 */

import { getModel, type Model } from '@mariozechner/pi-ai'
import {
  type LlmEmitter as CoreLlmEmitter,
  type LlmRequest as CoreLlmRequest,
  type LlmResult as CoreLlmResult,
  llmCall as coreLlmCall,
  type WakeScope,
} from '@vobase/core'

import type { LlmTask } from './events'

// ---------- Model alias map ----------
// Pure constants/helpers live in a frontend-safe module so pages can import
// them without dragging the @vobase/core barrel into the Vite bundle.

import { DEFAULT_CHAT_MODEL, MODEL_OPTIONS, models, splitModelId } from '@modules/agents/lib/models'

export { DEFAULT_CHAT_MODEL, MODEL_OPTIONS, models, splitModelId }

// ---------- Provider wiring ----------

export interface ProviderEnv {
  bifrostUrl: string | undefined
  bifrostKey: string | undefined
  openaiKey: string | undefined
  anthropicKey: string | undefined
  googleKey: string | undefined
}

function readEnv(): ProviderEnv {
  return {
    bifrostUrl: process.env.BIFROST_URL,
    bifrostKey: process.env.BIFROST_API_KEY,
    openaiKey: process.env.OPENAI_API_KEY,
    anthropicKey: process.env.ANTHROPIC_API_KEY,
    googleKey: process.env.GOOGLE_API_KEY,
  }
}

function isBifrostMode(env: ProviderEnv = readEnv()): boolean {
  return Boolean(env.bifrostKey && env.bifrostUrl)
}

/**
 * Build a pi-ai `Model` for the given provider-prefixed id. Callers may
 * mutate the returned object — it's a fresh shallow copy.
 */
// biome-ignore lint/suspicious/noExplicitAny: Model api type varies per provider; pi-ai narrows it at the call site
export function createModel(fullId: string = DEFAULT_CHAT_MODEL): Model<any> {
  const env = readEnv()
  const { provider, model: bareId } = splitModelId(fullId)

  if (isBifrostMode(env) && env.bifrostUrl) {
    // Use pi-ai's openai-responses template; Bifrost exposes the OpenAI
    // Responses API shape. Overwrite id + baseUrl so Bifrost can dispatch
    // across underlying providers by the `{provider}/{model}` prefix.
    const tmpl = getModel('openai', 'gpt-5.4' as never) as unknown as Model<'openai-responses'>
    return { ...tmpl, id: fullId, provider: 'openai', baseUrl: env.bifrostUrl } as unknown as Model<never>
  }

  // Direct mode — provider-native endpoint. pi-ai returns undefined (not
  // throws) for unknown provider/id pairs; fall back to the default rather
  // than surfacing "No API provider registered for api: undefined".
  const direct = getModel(provider as never, bareId as never) as unknown as Model<never> | undefined
  if (!direct?.api) {
    if (fullId === DEFAULT_CHAT_MODEL) {
      throw new Error(`llm: default model ${DEFAULT_CHAT_MODEL} is not known to pi-ai`)
    }
    return createModel(DEFAULT_CHAT_MODEL)
  }
  return { ...direct } as Model<never>
}

/**
 * Resolve the API key for the given model. In Bifrost mode we always use the
 * gateway key regardless of the underlying model provider. In direct mode we
 * pick the key that matches the model's provider.
 *
 * Returns undefined when no key is configured — pi-ai treats that as "omit
 * the Authorization header", which is what tests relying on `stubStreamFn`
 * want.
 */
export function resolveApiKey(model?: { provider?: string } | null): string | undefined {
  const env = readEnv()
  if (isBifrostMode(env)) return env.bifrostKey
  const provider = model?.provider ?? 'openai'
  if (provider === 'openai') return env.openaiKey
  if (provider === 'anthropic') return env.anthropicKey
  if (provider === 'google') return env.googleKey
  return undefined
}

export const HARNESS_DEFAULT_MODEL_ID: string = DEFAULT_CHAT_MODEL

// ---------- llmCall wrapper ----------

// biome-ignore lint/suspicious/noExplicitAny: emitter is write-only; matches `@vobase/core`'s LlmEmitter default
export type LlmEmitter<TEvent = any> = CoreLlmEmitter<TEvent>

export interface LlmRequest extends CoreLlmRequest {
  model?: string
}

export type LlmResult<T = string> = Omit<CoreLlmResult<T>, 'task'> & { task: LlmTask }

export interface LlmCallArgs {
  wake: WakeScope
  task: LlmTask
  request: LlmRequest
  emitter?: LlmEmitter
  parse?: (text: string) => unknown
}

export async function llmCall<T = string>(args: LlmCallArgs): Promise<LlmResult<T>> {
  const model = createModel(args.request.model)
  const apiKey = resolveApiKey(model)
  const res = await coreLlmCall<T>({
    wake: args.wake,
    task: args.task,
    model,
    apiKey,
    request: args.request,
    emitter: args.emitter,
    parse: args.parse,
  })
  return { ...res, task: args.task }
}
