/**
 * Template-owned LLM chokepoint for non-turn observers (scorer, moderation,
 * memory-distill, learn-propose, caption, intent).
 *
 * The agent's own turn stream still flows through `@mariozechner/pi-agent-core`
 * via `createHarness`. This helper is for side-call LLM use that needs the
 * same cost/latency/event accounting:
 *
 *   - Resolves model + apiKey via `llm-provider.ts`.
 *   - Calls pi-ai's `complete()` directly.
 *   - Synthesises a `llm_call` `HarnessEvent` on completion and surfaces it
 *     through the caller-supplied `emitter` so `costAggregator` observes it
 *     uniformly with the turn stream.
 *
 * Callers are plain `on_event` listeners. They close over a per-wake
 * `LlmEmitter` (the handle returned by `createHarness`'s `emitEventHandle`)
 * and pull `wake` identity off the triggering event.
 */

import { complete, type Message, type Model, type UserMessage } from '@mariozechner/pi-ai'
import type { LlmTask } from '@server/contracts/event'
import type { WakeScope } from '@vobase/core'
import { createModel, resolveApiKey } from './llm-provider'

export interface LlmRequest {
  model?: string
  system?: string
  messages?: ReadonlyArray<{ role: 'user' | 'assistant' | 'system'; content: string }>
  signal?: AbortSignal
  temperature?: number
  maxTokens?: number
}

export interface LlmResult<T = string> {
  task: LlmTask
  model: string
  provider: string
  content: T
  tokensIn: number
  tokensOut: number
  cacheReadTokens: number
  costUsd: number
  latencyMs: number
  cacheHit: boolean
  finishReason: string
}

/**
 * Handle populated by `createHarness({ emitEventHandle })`. Listeners capture
 * the handle at registration time; the harness wires `emit` before the run
 * starts, so listener invocations find it live.
 *
 * Generic over the event type so template callers (scorer, learning-proposal,
 * moderation) can publish their domain-specific `AgentEvent` variants through
 * the same handle that `llmCall` uses to surface `llm_call` events.
 */
// biome-ignore lint/suspicious/noExplicitAny: emitter is write-only; variance deliberately loose so AgentEvent supersets HarnessEvent
export interface LlmEmitter<TEvent = any> {
  emit?: (ev: TEvent) => void
}

export interface LlmCallArgs {
  wake: WakeScope
  task: LlmTask
  request: LlmRequest
  emitter?: LlmEmitter
  /**
   * Optional parser for `T !== string`. Default returns the concatenated
   * assistant text. Callers that expect JSON pass `JSON.parse`.
   */
  parse?: (text: string) => unknown
}

function toPiMessages(msgs: LlmRequest['messages']): Message[] {
  if (!msgs || msgs.length === 0) return []
  const out: Message[] = []
  for (const m of msgs) {
    if (m.role !== 'user') continue
    const um: UserMessage = { role: 'user', content: m.content, timestamp: Date.now() }
    out.push(um)
  }
  return out
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const block of content as Array<{ type: string; text?: string }>) {
    if (block?.type === 'text' && typeof block.text === 'string') out += block.text
  }
  return out
}

export async function llmCall<T = string>(args: LlmCallArgs): Promise<LlmResult<T>> {
  const { wake, task, request, emitter, parse } = args
  // biome-ignore lint/suspicious/noExplicitAny: Model api type varies per provider; pi-ai narrows at the call site
  const model: Model<any> = createModel(request.model)
  const apiKey = resolveApiKey(model)

  const systemFromRequest = request.system
  const systemFromMessages = request.messages?.find((m) => m.role === 'system')?.content
  const systemPrompt = systemFromRequest ?? systemFromMessages

  const startedAt = Date.now()
  const assistant = await complete(
    model,
    {
      systemPrompt,
      messages: toPiMessages(request.messages),
    },
    {
      apiKey,
      signal: request.signal,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
    },
  )
  const latencyMs = Date.now() - startedAt

  const usage = assistant.usage
  const tokensIn = usage?.input ?? 0
  const tokensOut = usage?.output ?? 0
  const cacheReadTokens = usage?.cacheRead ?? 0
  const costUsd = usage?.cost?.total ?? 0
  const text = extractText(assistant.content)
  const content = (parse ? parse(text) : text) as T
  const finishReason = typeof assistant.stopReason === 'string' ? assistant.stopReason : 'stop'

  emitter?.emit?.({
    ts: new Date(),
    wakeId: wake.wakeId,
    conversationId: wake.conversationId,
    organizationId: wake.organizationId,
    turnIndex: wake.turnIndex,
    type: 'llm_call',
    task,
    model: model.id,
    provider: model.provider,
    tokensIn,
    tokensOut,
    cacheReadTokens,
    costUsd,
    latencyMs,
    cacheHit: cacheReadTokens > 0,
  })

  return {
    task,
    model: model.id,
    provider: model.provider,
    content,
    tokensIn,
    tokensOut,
    cacheReadTokens,
    costUsd,
    latencyMs,
    cacheHit: cacheReadTokens > 0,
    finishReason,
  }
}
