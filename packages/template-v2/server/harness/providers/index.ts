/**
 * Provider factory — `pickProvider(config)` -> LlmProvider. Plan §P2.1.
 *
 * Anthropic is the critical path; OpenAI is wired for live-smoke tests. Gemini
 * remains a stretch. The `mock` kind lets tests inject a pre-built provider
 * without going through the HTTP layer.
 */

import type { LlmProvider } from '@server/contracts/provider-port'
import { type AnthropicProviderConfig, createAnthropicProvider } from './anthropic'
import { createOpenAIProvider, type OpenAIProviderConfig } from './openai'

export type ProviderConfig =
  | { kind: 'anthropic'; anthropic: AnthropicProviderConfig }
  | { kind: 'openai'; openai: OpenAIProviderConfig }
  | { kind: 'mock'; provider: LlmProvider }

export function pickProvider(config: ProviderConfig): LlmProvider {
  switch (config.kind) {
    case 'anthropic':
      return createAnthropicProvider(config.anthropic)
    case 'openai':
      return createOpenAIProvider(config.openai)
    case 'mock':
      return config.provider
    default: {
      const exhaustive: never = config
      throw new Error(`unknown provider kind: ${String(exhaustive)}`)
    }
  }
}

export type { AnthropicProviderConfig } from './anthropic'
export { createAnthropicProvider } from './anthropic'
export type { OpenAIProviderConfig } from './openai'
export { createOpenAIProvider } from './openai'
