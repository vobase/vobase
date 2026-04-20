/**
 * `llmCall` chokepoint — THE single entry point for every LLM invocation.
 *
 * Every call emits an `llm_call` event carrying task, model, provider, token
 * counts, cache hit ratio, cost, latency. This is how `agents.conversation_events`
 * gets its cost/latency columns without leaking provider shapes upward.
 *
 * Providers are pluggable; Phase 1 only exercises the mock path. Phase 2+ wires
 * the real OpenAI/Anthropic/Gemini path via pi-mono or Bifrost.
 */

import type { AgentEvent, LlmTask } from '@server/contracts/event'
import type { EventBus, LlmRequest, LlmResult } from '@server/contracts/plugin-context'
import type { LlmProvider as StreamingLlmProvider } from '@server/contracts/provider-port'
import { nanoid } from 'nanoid'

export interface LlmProvider {
  id: string
  /** Called with a resolved model + the request. Must NOT emit events — that's `llmCall`'s job. */
  call<T = string>(request: ResolvedLlmRequest): Promise<ProviderResult<T>>
}

export interface ResolvedLlmRequest extends LlmRequest {
  model: string
  provider: string
}

export interface ProviderResult<T = string> {
  content: T
  tokensIn: number
  tokensOut: number
  cacheReadTokens: number
  costUsd: number
  cacheHit: boolean
  finishReason?: string
}

export interface LlmCallOptions {
  events: EventBus
  provider: LlmProvider
  defaultModel: string
  wakeContext: {
    organizationId: string
    conversationId: string
    wakeId: string
    turnIndex: number
  }
}

export function makeLlmCall(opts: LlmCallOptions) {
  return async function llmCall<T = string>(task: LlmTask, request: LlmRequest): Promise<LlmResult<T>> {
    const startedAt = Date.now()
    const resolved: ResolvedLlmRequest = {
      ...request,
      model: request.model ?? opts.defaultModel,
      provider: request.provider ?? opts.provider.id,
    }
    const providerResult = await opts.provider.call<T>(resolved)
    const latencyMs = Date.now() - startedAt

    const event: AgentEvent = {
      type: 'llm_call',
      ts: new Date(),
      wakeId: opts.wakeContext.wakeId,
      conversationId: opts.wakeContext.conversationId,
      organizationId: opts.wakeContext.organizationId,
      turnIndex: opts.wakeContext.turnIndex,
      task,
      model: resolved.model,
      provider: resolved.provider,
      tokensIn: providerResult.tokensIn,
      tokensOut: providerResult.tokensOut,
      cacheReadTokens: providerResult.cacheReadTokens,
      costUsd: providerResult.costUsd,
      latencyMs,
      cacheHit: providerResult.cacheHit,
    }
    opts.events.publish(event)

    return {
      task,
      model: resolved.model,
      provider: resolved.provider,
      content: providerResult.content,
      tokensIn: providerResult.tokensIn,
      tokensOut: providerResult.tokensOut,
      cacheReadTokens: providerResult.cacheReadTokens,
      costUsd: providerResult.costUsd,
      latencyMs,
      cacheHit: providerResult.cacheHit,
      finishReason: providerResult.finishReason,
    }
  }
}

/** Test-only mock provider — deterministic, no network. */
export function mockProvider(opts?: {
  id?: string
  responseText?: string
  tokensIn?: number
  tokensOut?: number
  costUsd?: number
}): LlmProvider {
  return {
    id: opts?.id ?? 'mock',
    async call<T = string>(request: ResolvedLlmRequest): Promise<ProviderResult<T>> {
      const text = opts?.responseText ?? 'ok'
      return {
        content: text as unknown as T,
        tokensIn: opts?.tokensIn ?? request.messages?.length ?? 0,
        tokensOut: opts?.tokensOut ?? text.length,
        cacheReadTokens: 0,
        costUsd: opts?.costUsd ?? 0,
        cacheHit: false,
        finishReason: 'stop',
      }
    },
  }
}

/**
 * Adapt a streaming `StreamingLlmProvider` (from `server/contracts/provider-port`,
 * used inside the harness turn loop) into the request-response `LlmProvider`
 * this chokepoint expects. Drains the streaming provider, concatenates text
 * deltas, and surfaces the terminal `finish` metadata unchanged.
 */
export function makeStreamingLlmProvider(streaming: StreamingLlmProvider): LlmProvider {
  return {
    id: streaming.name,
    async call<T = string>(request: ResolvedLlmRequest): Promise<ProviderResult<T>> {
      let text = ''
      let tokensIn = 0
      let tokensOut = 0
      let cacheReadTokens = 0
      let costUsd = 0
      let cacheHit = false
      let finishReason: string | undefined
      for await (const chunk of streaming.stream(request)) {
        switch (chunk.type) {
          case 'text-delta':
            text += chunk.text
            break
          case 'finish':
            tokensIn = chunk.tokensIn
            tokensOut = chunk.tokensOut
            cacheReadTokens = chunk.cacheReadTokens
            costUsd = chunk.costUsd
            cacheHit = chunk.cacheHit
            finishReason = chunk.finishReason
            break
          default:
            break
        }
      }
      return {
        content: text as unknown as T,
        tokensIn,
        tokensOut,
        cacheReadTokens,
        costUsd,
        cacheHit,
        finishReason,
      }
    },
  }
}

/** Used by the harness to mint a stable `wakeId`. Exposed so tests can assert wake scoping. */
export function newWakeId(): string {
  return nanoid(12)
}
