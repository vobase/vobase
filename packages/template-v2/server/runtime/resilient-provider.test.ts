import { describe, expect, it } from 'bun:test'
import type { ErrorClassifiedEvent } from '@server/contracts/event'
import type { LlmProvider, LlmStreamChunk } from '@server/contracts/provider-port'
import { EventBus } from './event-bus'
import { makeResilientProvider } from './resilient-provider'

const noopLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

const successChunks: LlmStreamChunk[] = [
  { type: 'text-delta', text: 'hello' },
  {
    type: 'finish',
    finishReason: 'end_turn',
    tokensIn: 10,
    tokensOut: 5,
    cacheReadTokens: 0,
    costUsd: 0.001,
    latencyMs: 100,
    cacheHit: false,
  },
]

function throwingStream(err: unknown): AsyncIterableIterator<LlmStreamChunk> {
  const it: AsyncIterableIterator<LlmStreamChunk> = {
    async next(): Promise<IteratorResult<LlmStreamChunk>> {
      throw err
    },
    [Symbol.asyncIterator]() {
      return this
    },
  }
  return it
}

async function* successStream(): AsyncIterableIterator<LlmStreamChunk> {
  for (const chunk of successChunks) yield chunk
}

function makePolicy(bus: EventBus) {
  return {
    events: bus,
    logger: noopLogger,
    getScope: () => ({ tenantId: 't1', conversationId: 'c1', wakeId: 'w1', turnIndex: 0 }),
    maxTransientRetries: 3,
  }
}

async function drain(provider: LlmProvider): Promise<LlmStreamChunk[]> {
  const chunks: LlmStreamChunk[] = []
  for await (const chunk of provider.stream({})) chunks.push(chunk)
  return chunks
}

describe('makeResilientProvider', () => {
  it('413 → compress → retry → success', async () => {
    const bus = new EventBus()
    const classified: ErrorClassifiedEvent[] = []
    bus.subscribe((ev) => {
      if (ev.type === 'error_classified') classified.push(ev as ErrorClassifiedEvent)
    })

    let callCount = 0
    const inner: LlmProvider = {
      name: 'stub',
      stream() {
        callCount += 1
        if (callCount === 1) return throwingStream(Object.assign(new Error('payload too large'), { status: 413 }))
        return successStream()
      },
    }
    const provider = makeResilientProvider(inner, makePolicy(bus))
    const chunks = await drain(provider)

    expect(chunks.some((c) => c.type === 'text-delta')).toBe(true)
    expect(callCount).toBe(2)
    expect(classified).toHaveLength(1)
    expect(classified[0].reason).toBe('payload_too_large')
  })

  it('transient/network → retry → success', async () => {
    const bus = new EventBus()
    const classified: ErrorClassifiedEvent[] = []
    bus.subscribe((ev) => {
      if (ev.type === 'error_classified') classified.push(ev as ErrorClassifiedEvent)
    })

    let callCount = 0
    const inner: LlmProvider = {
      name: 'stub',
      stream() {
        callCount += 1
        if (callCount <= 2) return throwingStream(new Error('fetch failed: ECONNRESET'))
        return successStream()
      },
    }
    const provider = makeResilientProvider(inner, makePolicy(bus))
    const chunks = await drain(provider)

    expect(chunks.some((c) => c.type === 'text-delta')).toBe(true)
    expect(callCount).toBe(3)
    expect(classified).toHaveLength(2)
    expect(classified[0].reason).toBe('transient')
  })

  it('context_overflow → compress → retry → success', async () => {
    const bus = new EventBus()
    const classified: ErrorClassifiedEvent[] = []
    bus.subscribe((ev) => {
      if (ev.type === 'error_classified') classified.push(ev as ErrorClassifiedEvent)
    })

    const receivedRequests: unknown[] = []
    let callCount = 0
    const inner: LlmProvider = {
      name: 'stub',
      stream(req) {
        receivedRequests.push(req)
        callCount += 1
        if (callCount === 1)
          return throwingStream(
            Object.assign(new Error("This model's maximum context length is 128000 tokens"), {
              status: 400,
              code: 'context_length_exceeded',
            }),
          )
        return successStream()
      },
    }
    const provider = makeResilientProvider(inner, makePolicy(bus))
    const chunks = await drain(provider)

    expect(chunks.some((c) => c.type === 'text-delta')).toBe(true)
    expect(callCount).toBe(2)
    expect(classified[0].reason).toBe('context_overflow')
  })

  it('unknown error → no retry + error_classified emitted', async () => {
    const bus = new EventBus()
    const classified: ErrorClassifiedEvent[] = []
    bus.subscribe((ev) => {
      if (ev.type === 'error_classified') classified.push(ev as ErrorClassifiedEvent)
    })

    let callCount = 0
    const inner: LlmProvider = {
      name: 'stub',
      stream() {
        callCount += 1
        return throwingStream(Object.assign(new Error('flux_capacitor_overload: exotic error'), { status: 418 }))
      },
    }
    const provider = makeResilientProvider(inner, makePolicy(bus))

    await expect(drain(provider)).rejects.toThrow('flux_capacitor_overload')
    expect(callCount).toBe(1)
    expect(classified).toHaveLength(1)
    expect(classified[0].reason).toBe('unknown')
  })
})
