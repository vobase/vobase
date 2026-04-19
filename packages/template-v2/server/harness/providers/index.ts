/**
 * Provider factory — `pickProvider(config)` -> LlmProvider.
 *
 * Anthropic is the critical path; OpenAI is wired for live-smoke tests. Gemini
 * remains a stretch. The `mock` kind lets tests inject a pre-built provider
 * without going through the HTTP layer.
 */

import type { LlmProvider } from '@server/contracts/provider-port'
import { type AnthropicProviderConfig, createAnthropicProvider } from './anthropic'
import { createGeminiProvider, type GeminiProviderConfig } from './gemini'
import { createOpenAIProvider, type OpenAIProviderConfig } from './openai'

export type ProviderConfig =
  | { kind: 'anthropic'; anthropic: AnthropicProviderConfig }
  | { kind: 'openai'; openai: OpenAIProviderConfig }
  | { kind: 'gemini'; gemini: GeminiProviderConfig }
  | { kind: 'mock'; provider: LlmProvider }

export function pickProvider(config: ProviderConfig): LlmProvider {
  switch (config.kind) {
    case 'anthropic':
      return createAnthropicProvider(config.anthropic)
    case 'openai':
      return createOpenAIProvider(config.openai)
    case 'gemini':
      return createGeminiProvider(config.gemini)
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
export type { GeminiProviderConfig } from './gemini'
export { createGeminiProvider } from './gemini'
export type { OpenAIProviderConfig } from './openai'
export { createOpenAIProvider } from './openai'
