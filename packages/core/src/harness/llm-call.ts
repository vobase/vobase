/**
 * Generic LLM chokepoint for non-turn use (scoring, memory distillation,
 * caption extraction, etc.) that still needs uniform `llm_call` accounting.
 *
 * Unlike the agent's own turn stream (which flows through
 * `@mariozechner/pi-agent-core` via `createHarness`), side-calls made here
 * call pi-ai's `complete()` directly and synthesise an `llm_call`
 * `HarnessEvent` via a caller-supplied emitter handle so `costAggregator`
 * observes them identically.
 *
 * The helper is domain-free: the caller resolves `model` and `apiKey`
 * (provider/gateway selection, env keys) and passes them in. The returned
 * `llm_call` event is not published by this module — it flows to the emitter
 * handle typically wired up by `createHarness({ emitEventHandle })`.
 */

import { complete, type Message, type Model, type UserMessage } from '@mariozechner/pi-ai'

import type { WakeScope } from './create-harness'

export interface LlmRequest {
  system?: string
  messages?: ReadonlyArray<{ role: 'user' | 'assistant' | 'system'; content: string }>
  signal?: AbortSignal
  temperature?: number
  maxTokens?: number
}

export interface LlmResult<T = string> {
  task: string
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
 * Handle populated by `createHarness({ emitEventHandle })`. Callers capture
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
  task: string
  // biome-ignore lint/suspicious/noExplicitAny: Model api type varies per provider; pi-ai narrows at the call site
  model: Model<any>
  apiKey?: string
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
  const { wake, task, model, apiKey, request, emitter, parse } = args

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
