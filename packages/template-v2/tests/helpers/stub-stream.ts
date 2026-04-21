/**
 * Test helper: build a pi-agent-core `StreamFn` that replays canned
 * `AssistantMessageEvent[]` sequences, one per LLM call.
 *
 * Replaces the old `mock-stream.ts` + JSONL-fixture machinery. Tests author
 * inline event arrays in TypeScript; each element of the outer array is the
 * full event sequence for a single LLM call (one turn, or sub-turn).
 *
 * Terminal event discipline: each inner array must end with either a `done`
 * or `error` event. If the caller forgets, `stubStreamFn` appends a default
 * `done` with stopReason `stop`.
 */

import type { AssistantMessageEvent } from '@mariozechner/pi-ai'
import { createAssistantMessageEventStream } from '@mariozechner/pi-ai'
import type { StreamFn } from '@mariozechner/pi-agent-core'

export interface StubStreamOptions {
  /**
   * Called synchronously whenever the stub stream is invoked — useful for
   * asserting call count / request shape in tests.
   */
  onCall?: (callIndex: number) => void
}

export function stubStreamFn(scripts: AssistantMessageEvent[][], opts: StubStreamOptions = {}): StreamFn {
  let callIndex = 0
  return (_model, _context, _options) => {
    const script = scripts[callIndex] ?? scripts[scripts.length - 1] ?? []
    opts.onCall?.(callIndex)
    callIndex += 1

    const stream = createAssistantMessageEventStream()
    // Push asynchronously so consumers can start iterating before events flush.
    queueMicrotask(() => {
      let terminal: AssistantMessageEvent | undefined
      for (const ev of script) {
        if (ev.type === 'done' || ev.type === 'error') {
          terminal = ev
          continue
        }
        stream.push(ev)
      }
      if (!terminal) {
        // Synthesise a minimal done event so the stream terminates cleanly.
        const lastEvent = script[script.length - 1]
        const lastPartial = lastEvent && 'partial' in lastEvent ? lastEvent.partial : undefined
        if (lastPartial) {
          terminal = { type: 'done', reason: 'stop', message: { ...lastPartial, stopReason: 'stop' } }
        }
      }
      if (terminal?.type === 'done') {
        stream.push(terminal)
        stream.end(terminal.message)
      } else if (terminal?.type === 'error') {
        stream.push(terminal)
        stream.end(terminal.error)
      } else {
        stream.end()
      }
    })
    return stream
  }
}
