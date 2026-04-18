import { describe, expect, it } from 'bun:test'
import type { AgentEvent } from '@server/contracts/event'
import { EventBus } from './event-bus'

function fakeEvent(): AgentEvent {
  return {
    type: 'turn_start',
    ts: new Date(),
    wakeId: 'w1',
    conversationId: 'c1',
    tenantId: 't1',
    turnIndex: 0,
  }
}

describe('EventBus', () => {
  it('fans out to every subscriber synchronously', () => {
    const bus = new EventBus()
    const a: AgentEvent[] = []
    const b: AgentEvent[] = []
    bus.subscribe((e) => {
      a.push(e)
    })
    bus.subscribe((e) => {
      b.push(e)
    })
    bus.publish(fakeEvent())
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
  })

  it('subscriber throws do not propagate and are routed to onError', () => {
    const errors: Array<{ event: AgentEvent; err: unknown }> = []
    const bus = new EventBus({ onError: (err, event) => errors.push({ err, event }) })
    const b: AgentEvent[] = []
    bus.subscribe(() => {
      throw new Error('boom')
    })
    bus.subscribe((e) => {
      b.push(e)
    })
    bus.publish(fakeEvent())
    expect(b).toHaveLength(1)
    expect(errors).toHaveLength(1)
    expect(String((errors[0] as { err: Error }).err.message)).toBe('boom')
  })

  it('unsubscribe removes the subscriber', () => {
    const bus = new EventBus()
    const a: AgentEvent[] = []
    const off = bus.subscribe((e) => {
      a.push(e)
    })
    bus.publish(fakeEvent())
    off()
    bus.publish(fakeEvent())
    expect(a).toHaveLength(1)
    expect(bus.size()).toBe(0)
  })
})
