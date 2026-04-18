/**
 * pi-agent-core adapter — plan §P2.1, risk row 1.
 *
 * Responsibilities:
 *
 * 1. Convert our `LlmProvider` (chunk-level, Anthropic-shaped) into a `StreamFn`
 *    consumable by the harness's existing state machine. `drainProviderToMockStream()`
 *    collects provider chunks, accumulates tool-use JSON deltas into complete
 *    args, and returns the flattened `MockStreamEvent` list plus the terminal
 *    `LlmFinish` metadata (tokens/cost/latency/cacheHit) that agent-runner
 *    patches into the `llm_call` event.
 *
 * 2. Wrap a real `pi-agent-core` `Agent` instance so we can assert — in
 *    `tests/harness/agent-adapter.test.ts` — that the pi-mono Agent lifecycle
 *    produces the same canonical contract-event sequence Phase 1's hand-rolled
 *    runner produces. `translatePiMonoEvents()` is the pure translation rule
 *    used by the test.
 *
 * The runner keeps its hand-rolled state machine for the mock path (Phase 1
 * regression guard). The provider path flows through `drainProviderToMockStream`
 * inside the same state machine — event ordering is preserved unchanged.
 */

import type { AgentEvent as PiAgentEvent, AgentTool as PiAgentTool } from '@mariozechner/pi-agent-core'
import { Agent as PiAgent } from '@mariozechner/pi-agent-core'
import type { LlmRequest } from '@server/contracts/plugin-context'
import type { LlmFinish, LlmProvider } from '@server/contracts/provider-port'
import type { MockStreamEvent, StreamFn } from './mock-stream'

// ─── Provider -> harness stream bridge ──────────────────────────────────────

export interface ProviderTurnResult {
  events: MockStreamEvent[]
  finish: LlmFinish
}

/**
 * Drain one provider turn into the `MockStreamEvent` shape the harness state
 * machine consumes. Returns the flattened event list plus the terminal `finish`
 * chunk so agent-runner can patch the `llm_call` event with real metadata.
 *
 * Tool-use chunks (start/delta/end) are aggregated into a single `tool-call`
 * event whose `args` are the JSON-parsed accumulated delta stream.
 */
export async function drainProviderTurn(provider: LlmProvider, request: LlmRequest): Promise<ProviderTurnResult> {
  const events: MockStreamEvent[] = []
  const toolAccum = new Map<string, { toolName: string; jsonDelta: string }>()
  let finish: LlmFinish | undefined

  for await (const chunk of provider.stream(request)) {
    switch (chunk.type) {
      case 'text-delta':
        events.push({ type: 'text-delta', delta: chunk.text })
        break
      case 'tool-use-start':
        toolAccum.set(chunk.toolCallId, { toolName: chunk.toolName, jsonDelta: '' })
        break
      case 'tool-use-delta': {
        const entry = toolAccum.get(chunk.toolCallId)
        if (entry) entry.jsonDelta += chunk.inputJsonDelta
        break
      }
      case 'tool-use-end': {
        const entry = toolAccum.get(chunk.toolCallId)
        if (!entry) break
        toolAccum.delete(chunk.toolCallId)
        const args = safeParseJson(entry.jsonDelta)
        events.push({
          type: 'tool-call',
          toolCallId: chunk.toolCallId,
          toolName: entry.toolName,
          args,
        })
        break
      }
      case 'finish':
        finish = chunk
        break
      default: {
        const _exhaustive: never = chunk
        void _exhaustive
      }
    }
  }

  events.push({
    type: 'finish',
    finishReason: toFinalFinishReason(finish?.finishReason ?? 'end_turn'),
  })

  return {
    events,
    finish:
      finish ??
      ({
        type: 'finish',
        finishReason: 'end_turn',
        tokensIn: 0,
        tokensOut: 0,
        cacheReadTokens: 0,
        costUsd: 0,
        latencyMs: 0,
        cacheHit: false,
      } satisfies LlmFinish),
  }
}

/**
 * Build a `StreamFn` from an `LlmProvider` that the harness can consume in
 * place of `mockStreamFn`. Exposes the terminal `LlmFinish` via the returned
 * `finishRef` so the caller can patch the `llm_call` event retroactively.
 */
export function providerToStreamFn(
  provider: LlmProvider,
  request: LlmRequest,
): { streamFn: StreamFn; finishRef: { value: LlmFinish | undefined } } {
  const finishRef: { value: LlmFinish | undefined } = { value: undefined }
  async function* drainToGenerator(): AsyncGenerator<MockStreamEvent, void, unknown> {
    const drained = await drainProviderTurn(provider, request)
    finishRef.value = drained.finish
    for (const ev of drained.events) yield ev
  }
  const streamFn: StreamFn = () => drainToGenerator()
  return { streamFn, finishRef }
}

function safeParseJson(raw: string): unknown {
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function toFinalFinishReason(
  reason: LlmFinish['finishReason'],
): MockStreamEvent extends infer E ? (E extends { type: 'finish'; finishReason: infer R } ? R : never) : never {
  switch (reason) {
    case 'tool_use':
      return 'tool_calls' as never
    case 'max_tokens':
      return 'length' as never
    case 'error':
      return 'error' as never
    default:
      return 'stop' as never
  }
}

// ─── pi-mono Agent wrapper ──────────────────────────────────────────────────

/**
 * Instantiates a real `pi-agent-core` `Agent`. Used by the adapter test to
 * prove a pi-mono `Agent` lifecycle translates to the same canonical contract
 * event sequence Phase 1's hand-rolled runner emits.
 *
 * The Agent is constructed with a streamFn bridge that wraps our `LlmProvider`.
 * Tools are passed as pi-mono `AgentTool`s (typed via TypeBox in our tool
 * catalog — see server/contracts/tool.ts).
 */
export interface CreatePiAgentOpts {
  systemPrompt: string
  model: {
    id: string
    provider: string
  }
  tools?: PiAgentTool[]
}

export function createPiAgent(opts: CreatePiAgentOpts): PiAgent {
  return new PiAgent({
    initialState: {
      systemPrompt: opts.systemPrompt,
      // Cast via `unknown` to satisfy pi-ai's generic `Model<Api>` constraint
      // without importing the full registry. The adapter test uses a stubbed
      // streamFn so the concrete model provider never reaches pi-ai.
      model: {
        id: opts.model.id,
        name: opts.model.id,
        api: 'anthropic-messages',
        provider: opts.model.provider,
        baseUrl: '',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 4096,
      } as unknown as PiAgent['state']['model'],
      thinkingLevel: 'off',
      tools: opts.tools ?? [],
      messages: [],
    },
    // pi-ai's streamSimple signature is (model, context, options?) -> AssistantMessageEventStream.
    // The adapter test injects its own streamFn via `.streamFn = ...` after construction.
    convertToLlm: (msgs) => msgs as unknown as Parameters<PiAgent['convertToLlm']>[0],
  })
}

/**
 * Translate pi-mono `AgentEvent` -> our canonical event TYPE in the order they
 * appear in a turn. Kept as a pure function so the adapter test can assert
 * event sequence parity without running the full harness.
 *
 * Returns the list of contract event types we would emit given a captured
 * pi-mono event stream. The harness adds wake metadata (wakeId, tenantId,
 * conversationId, turnIndex) on top at emit time.
 */
export function translatePiMonoEvents(events: readonly PiAgentEvent[]): string[] {
  const out: string[] = []
  for (const ev of events) {
    switch (ev.type) {
      case 'agent_start':
        out.push('agent_start')
        break
      case 'turn_start':
        out.push('turn_start', 'llm_call')
        break
      case 'message_start':
        out.push('message_start')
        break
      case 'message_update':
        out.push('message_update')
        break
      case 'message_end':
        out.push('message_end')
        break
      case 'tool_execution_start':
        out.push('tool_execution_start')
        break
      case 'tool_execution_end':
        out.push('tool_execution_end')
        break
      case 'turn_end':
        out.push('turn_end')
        break
      case 'agent_end':
        out.push('agent_end')
        break
      default:
        // tool_execution_update is optional in our contract; drop.
        break
    }
  }
  return out
}

/** Canonical event-TYPE sequence for a single-turn no-tool-call wake. */
export const PHASE_1_CANONICAL_EVENT_SEQUENCE: readonly string[] = [
  'agent_start',
  'turn_start',
  'llm_call',
  'message_start',
  'message_update',
  'message_end',
  'turn_end',
  'agent_end',
] as const
