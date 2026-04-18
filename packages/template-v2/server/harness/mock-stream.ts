/**
 * Test-only `mockStream(events)` factory — plan §P1.4 N2 + B4.
 *
 * Returns a `StreamFn`-compatible async generator producing pi-mono/agent
 * stream events. Consumed by `agent-runner.ts` to drive the harness's wake
 * state machine deterministically without a real LLM.
 *
 * **B4 invariant**: `agent-runner` MUST emit at least one `message_update`
 * between `message_start` and `message_end`. The convenience helper
 * `mockStream()` ensures at least one `text-delta` is present before `finish`
 * (synthesizing a trivial one if the caller only supplied a `finish` event).
 */

export type MockStreamEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-call'; toolCallId?: string; toolName: string; args: unknown }
  | { type: 'finish'; finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'error' }

export interface MockStreamRun {
  /** Flattened stream events for this turn. Order preserved. */
  events: MockStreamEvent[]
}

/**
 * Internal stream-fn shape consumed by agent-runner. Kept pluggable so we can
 * swap in pi-mono's real `StreamFn` later without changing callers.
 */
export type StreamFn = () => AsyncGenerator<MockStreamEvent, void, unknown>

/**
 * Build a `StreamFn` from a single flat event list (single-turn).
 * For multi-turn scripts, use `mockStreamTurns`.
 */
export function mockStream(events: MockStreamEvent[]): StreamFn {
  return mockStreamTurns([{ events }])
}

/**
 * Build a `StreamFn` that yields a DIFFERENT script per invocation.
 * `mockStreamTurns([t1, t2, t3])` yields t1 on the first call, t2 on the
 * second, t3 on the third — used by assertion 12 for multi-turn wakes.
 */
export function mockStreamTurns(turns: readonly MockStreamRun[]): StreamFn {
  let turnIdx = 0
  return function streamFn(): AsyncGenerator<MockStreamEvent, void, unknown> {
    const script = turns[Math.min(turnIdx, turns.length - 1)] ?? { events: [] }
    turnIdx += 1
    return runScript(script.events)
  }
}

async function* runScript(events: readonly MockStreamEvent[]): AsyncGenerator<MockStreamEvent, void, unknown> {
  let sawDelta = false
  let sawFinish = false
  for (const ev of events) {
    if (ev.type === 'text-delta') sawDelta = true
    if (ev.type === 'finish') sawFinish = true
    if (ev.type === 'finish' && !sawDelta) {
      // Guarantee at least one delta so harness always fires ≥1 message_update (B4).
      yield { type: 'text-delta', delta: '' }
      sawDelta = true
    }
    yield ev
  }
  if (!sawFinish) {
    // Default finish so the harness state machine can close the turn.
    yield { type: 'finish', finishReason: 'stop' }
  }
}
