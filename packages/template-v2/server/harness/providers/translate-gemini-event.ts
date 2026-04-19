/**
 * Gemini event translator — pure function mirroring `translateAnthropicEvent`
 * so fixture replay works identically across providers.
 *
 * Gemini streams `GenerateContentResponse` chunks. Text arrives incrementally
 * via `parts[i].text`; function calls appear as complete `parts[i].functionCall`
 * objects (not incrementally). We synthesise start/delta/end triples so the
 * harness sees the same chunk shape as Anthropic/OpenAI tool calls.
 *
 * `state.toolCallCounter` is caller-owned so IDs are deterministic per stream.
 */

import type { LlmFinish, LlmStreamChunk } from '@server/contracts/provider-port'

export interface GeminiUsage {
  promptTokenCount?: number
  candidatesTokenCount?: number
}

export interface GeminiTranslateState {
  toolCallCounter: number
}

export function translateGeminiEvent(
  event: unknown,
  state: GeminiTranslateState,
  onUsage: (u: GeminiUsage) => void,
  onFinishReason: (r: LlmFinish['finishReason']) => void,
): LlmStreamChunk[] {
  if (!event || typeof event !== 'object') return []
  const ev = event as Record<string, unknown>

  const usageMetadata = ev.usageMetadata as GeminiUsage | undefined
  if (usageMetadata) onUsage(usageMetadata)

  const candidates = ev.candidates as Array<Record<string, unknown>> | undefined
  if (!candidates || candidates.length === 0) return []

  const candidate = candidates[0]
  const out: LlmStreamChunk[] = []

  const content = candidate.content as { parts?: Array<Record<string, unknown>> } | undefined
  if (content?.parts) {
    for (const part of content.parts) {
      if (typeof part.text === 'string' && part.text.length > 0) {
        out.push({ type: 'text-delta', text: part.text })
      }
      const fnCall = part.functionCall as { name?: string; args?: unknown } | undefined
      if (fnCall?.name) {
        const toolCallId = `gemini-${++state.toolCallCounter}`
        const toolName = fnCall.name
        const inputJson = JSON.stringify(fnCall.args ?? {})
        out.push({ type: 'tool-use-start', toolCallId, toolName })
        out.push({ type: 'tool-use-delta', toolCallId, inputJsonDelta: inputJson })
        out.push({ type: 'tool-use-end', toolCallId })
      }
    }
  }

  const finishReason = candidate.finishReason
  if (typeof finishReason === 'string' && finishReason.length > 0) {
    onFinishReason(mapFinishReason(finishReason))
  }

  return out
}

function mapFinishReason(reason: string): LlmFinish['finishReason'] {
  switch (reason) {
    case 'STOP':
      return 'end_turn'
    case 'MAX_TOKENS':
      return 'max_tokens'
    case 'TOOL_CALLS':
      return 'tool_use'
    case 'SAFETY':
      return 'stop_sequence'
    default:
      return reason.toLowerCase()
  }
}
