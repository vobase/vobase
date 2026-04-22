/**
 * Pre-defined model aliases used across the agents module and harness.
 * Values are always the `{provider}/{model}` form that Bifrost routes on —
 * `llm-provider.createModel` strips the prefix in direct-API mode.
 *
 * To add a new model, append it here and use it via `models.*`. Never
 * hardcode a bare model id at a call site.
 */
export const models = {
  gpt_mini: 'openai/gpt-5.4-mini',
  gpt_standard: 'openai/gpt-5.4',
  claude_haiku: 'anthropic/claude-haiku-4-5',
  claude_sonnet: 'anthropic/claude-sonnet-4-6',
  gemini_flash: 'google/gemini-3-flash-preview',
  gemini_pro: 'google/gemini-3.1-pro-preview',
} as const

/** Default chat model for new agents and harness fallback. */
export const DEFAULT_CHAT_MODEL: string = models.claude_sonnet

/** Chat models selectable from the agent UI. */
export const MODEL_OPTIONS = [
  { value: models.claude_sonnet, label: 'Claude Sonnet 4.6' },
  { value: models.claude_haiku, label: 'Claude Haiku 4.5' },
  { value: models.gpt_standard, label: 'GPT-5.4' },
  { value: models.gpt_mini, label: 'GPT-5.4 Mini' },
  { value: models.gemini_pro, label: 'Gemini 3.1 Pro' },
  { value: models.gemini_flash, label: 'Gemini 3 Flash' },
] as const

/**
 * Split a provider-prefixed model id into `{ provider, model }`. Bare ids
 * (no slash) default to the `openai` provider so legacy agent rows still work.
 */
export function splitModelId(id: string): { provider: string; model: string } {
  const idx = id.indexOf('/')
  if (idx === -1) return { provider: 'openai', model: id }
  return { provider: id.slice(0, idx), model: id.slice(idx + 1) }
}
