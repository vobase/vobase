import { describe, expect, it } from 'bun:test'
import type { AgentEvent } from '@server/contracts/event'
import type { AgentObserver, Logger, ObserverContext } from '@server/contracts/observer'
import { ObserverBus } from './observer-bus'

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

function fakeCtx(): ObserverContext {
  return {
    organizationId: 't1',
    conversationId: 'c1',
    wakeId: 'w1',
    db: {} as ObserverContext['db'],
    logger: silentLogger,
    realtime: {} as ObserverContext['realtime'],
  }
}

function fakeEvent(): AgentEvent {
  return {
    type: 'turn_start',
    ts: new Date(),
    wakeId: 'w1',
    conversationId: 'c1',
    organizationId: 't1',
    turnIndex: 0,
  }
}

describe('ObserverBus', () => {
  it('delivers events to every registered observer', async () => {
    const bus = new ObserverBus({ logger: silentLogger, observerCtx: fakeCtx() })
    const a: AgentEvent[] = []
    const b: AgentEvent[] = []
    bus.register({ id: 'a', handle: (e) => void a.push(e) })
    bus.register({ id: 'b', handle: (e) => void b.push(e) })
    bus.publish(fakeEvent())
    bus.publish(fakeEvent())
    await bus.shutdown()
    expect(a).toHaveLength(2)
    expect(b).toHaveLength(2)
  })

  it('a slow observer does NOT backpressure a fast one', async () => {
    const bus = new ObserverBus({ logger: silentLogger, observerCtx: fakeCtx() })
    const fastTimestamps: number[] = []
    const slow: AgentObserver = {
      id: 'slow',
      handle: async () => {
        await new Promise((r) => setTimeout(r, 100))
      },
    }
    const fast: AgentObserver = {
      id: 'fast',
      handle: () => {
        fastTimestamps.push(performance.now())
      },
    }
    bus.register(slow)
    bus.register(fast)
    const publishedAt = performance.now()
    for (let i = 0; i < 5; i++) bus.publish(fakeEvent())

    // Wait for fast observer to drain
    await new Promise((r) => setTimeout(r, 20))
    expect(fastTimestamps.length).toBe(5)
    // Even the last fast call should land well before the slow observer's first 100ms sleep
    const lastFast = fastTimestamps[fastTimestamps.length - 1] ?? 0
    expect(lastFast - publishedAt).toBeLessThan(50)
    await bus.shutdown()
  })

  it('swallows observer throws without killing the queue', async () => {
    let errorLogs = 0
    const logger: Logger = {
      ...silentLogger,
      error: () => {
        errorLogs++
      },
    }
    const bus = new ObserverBus({ logger, observerCtx: fakeCtx() })
    const seen: AgentEvent[] = []
    bus.register({
      id: 'throws',
      handle: () => {
        throw new Error('bad')
      },
    })
    bus.register({ id: 'sees', handle: (e) => void seen.push(e) })
    bus.publish(fakeEvent())
    bus.publish(fakeEvent())
    await bus.shutdown()
    expect(seen).toHaveLength(2)
    expect(errorLogs).toBe(2)
  })

  it('rejects duplicate observer ids', () => {
    const bus = new ObserverBus({ logger: silentLogger, observerCtx: fakeCtx() })
    bus.register({ id: 'dup', handle: () => undefined })
    expect(() => bus.register({ id: 'dup', handle: () => undefined })).toThrow()
  })
})
