/**
 * sseObserver tests — after publishing N events, mock ctx.realtime.notify called N times.
 */

import { describe, expect, it } from 'bun:test'
import type { AgentEvent } from '@server/contracts/event'
import type { ObserverContext } from '@server/contracts/observer'
import type { ScopedDb } from '@server/contracts/scoped-db'
import { sseObserver } from './sse'

function makeCtx(notifyFn: (p: { table: string; id?: string; action?: string }) => void): ObserverContext {
  return {
    organizationId: 'ten1',
    conversationId: 'conv-sse-1',
    wakeId: 'wake-sse-1',
    ports: {} as ObserverContext['ports'],
    db: {} as unknown as ScopedDb,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    realtime: { notify: notifyFn },
  }
}

function makeEvent(type: string, conversationId = 'conv-sse-1'): AgentEvent {
  return {
    type: type as AgentEvent['type'],
    ts: new Date(),
    wakeId: 'wake-sse-1',
    conversationId,
    organizationId: 'ten1',
    turnIndex: 0,
  } as AgentEvent
}

describe('sseObserver', () => {
  it('has stable id', () => {
    expect(sseObserver.id).toBe('agents:sse')
  })

  it('calls realtime.notify once per event', () => {
    const calls: Array<{ table: string; id?: string; action?: string }> = []
    const ctx = makeCtx((p) => calls.push(p))

    const events: AgentEvent[] = [makeEvent('agent_start'), makeEvent('turn_start'), makeEvent('agent_end')]

    for (const event of events) {
      sseObserver.handle(event, ctx)
    }

    expect(calls).toHaveLength(3)
  })

  it('notify payload uses table=agent-sessions and conversationId as id', () => {
    const calls: Array<{ table: string; id?: string; action?: string }> = []
    const ctx = makeCtx((p) => calls.push(p))

    sseObserver.handle(makeEvent('llm_call', 'my-conv'), {
      ...ctx,
      conversationId: 'my-conv',
    })

    expect(calls[0]).toMatchObject({
      table: 'agent-sessions',
      id: 'my-conv',
      action: 'llm_call',
    })
  })

  it('calls notify N times for N events', () => {
    const calls: Array<{ table: string; id?: string; action?: string }> = []
    const ctx = makeCtx((p) => calls.push(p))

    const N = 7
    for (let i = 0; i < N; i++) {
      sseObserver.handle(makeEvent('message_update'), ctx)
    }

    expect(calls).toHaveLength(N)
  })
})
