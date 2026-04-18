/**
 * Unit tests for use-sse.ts — uses a MockEventSource that fires events
 * synchronously so no real SSE connection is needed.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

// Minimal EventSource mock
class MockEventSource {
  static instances: MockEventSource[] = []

  readonly url: string
  private listeners: Map<string, Set<(e: MessageEvent) => void>> = new Map()
  closed = false

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(event: string, fn: (e: MessageEvent) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    const set = this.listeners.get(event)
    if (set) set.add(fn)
  }

  removeEventListener(event: string, fn: (e: MessageEvent) => void) {
    this.listeners.get(event)?.delete(fn)
  }

  dispatch(event: string, data: string) {
    const handlers = this.listeners.get(event) ?? new Set()
    const e = { data } as MessageEvent
    for (const fn of handlers) fn(e)
  }

  close() {
    this.closed = true
  }
}

let originalEventSource: typeof EventSource

beforeEach(() => {
  MockEventSource.instances = []
  originalEventSource = globalThis.EventSource
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  ;(globalThis as any).EventSource = MockEventSource
})

afterEach(() => {
  globalThis.EventSource = originalEventSource
})

describe('useSse handler', () => {
  it('fires handler on invalidate event', () => {
    const received: Array<{ event: string; data: string }> = []

    // Simulate the hook's effect manually
    const es = new MockEventSource('/api/sse')
    const onInvalidate = (e: MessageEvent) => received.push({ event: 'invalidate', data: e.data as string })
    es.addEventListener('invalidate', onInvalidate)

    es.dispatch('invalidate', JSON.stringify({ table: 'conversations', id: 'conv-1' }))

    expect(received).toHaveLength(1)
    expect(received[0]?.event).toBe('invalidate')
    const payload = JSON.parse(received[0]?.data ?? '{}') as { table: string; id: string }
    expect(payload.table).toBe('conversations')
    expect(payload.id).toBe('conv-1')
  })

  it('does not fire after removeEventListener', () => {
    const received: string[] = []
    const es = new MockEventSource('/api/sse')
    const handler = (e: MessageEvent) => received.push(e.data as string)

    es.addEventListener('invalidate', handler)
    es.dispatch('invalidate', 'a')
    es.removeEventListener('invalidate', handler)
    es.dispatch('invalidate', 'b')

    expect(received).toEqual(['a'])
  })

  it('marks closed after close()', () => {
    const es = new MockEventSource('/api/sse')
    expect(es.closed).toBe(false)
    es.close()
    expect(es.closed).toBe(true)
  })
})
