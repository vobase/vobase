/**
 * Pre-call preflight check — estimate token count and compress if the request
 * is likely to exceed the model's context window.
 *
 * Used by `makeResilientProvider` before context_overflow/payload_too_large
 * retries, and optionally as a proactive guard when the request is known to be
 * large before the first call.
 */

import type { LlmRequest } from '@server/contracts/plugin-context'

/** 1 token ≈ 4 chars — conservative cross-provider estimate. */
const CHARS_PER_TOKEN = 4
const DEFAULT_CONTEXT_WINDOW = 128_000
const PREFLIGHT_THRESHOLD = 0.95

function estimateTokens(request: LlmRequest): number {
  const systemLen = request.system?.length ?? 0
  const messagesLen = (request.messages ?? []).reduce((acc, m) => acc + m.content.length, 0)
  return Math.ceil((systemLen + messagesLen) / CHARS_PER_TOKEN)
}

/** Returns true when the estimated token count exceeds 95% of the context window. */
export function shouldPreflight(request: LlmRequest, contextWindow = DEFAULT_CONTEXT_WINDOW): boolean {
  return estimateTokens(request) > PREFLIGHT_THRESHOLD * contextWindow
}

/**
 * Drop the oldest 50% of messages and halve the last one. Conversation history
 * is the dominant context contributor, so trimming the head is the only useful
 * single-pass compression — halving just the tail rarely moves the needle when
 * a long thread overflows. After this single pass, any remaining overflow
 * surfaces as `context_overflow` to the caller.
 */
export function compressRequest(request: LlmRequest): LlmRequest {
  const messages = request.messages ?? []
  if (messages.length === 0) return request
  const dropCount = Math.floor(messages.length / 2)
  const kept = messages.slice(dropCount)
  const lastIdx = kept.length - 1
  const last = kept[lastIdx]
  const trimmed = [
    ...kept.slice(0, lastIdx),
    { ...last, content: last.content.slice(0, Math.ceil(last.content.length / 2)) },
  ]
  return { ...request, messages: trimmed }
}
