/**
 * sseObserver tests — after publishing N events, mock realtime.notify called N times.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { AgentEvent } from '@server/contracts/event'
import { __resetServicesForTests, setDb, setLogger, setRealtime } from '@server/services'
import { sseObserver } from './sse'

function installRealtime(notifyFn: (p: { table: string; id?: string; action?: string }) => void): void {
  setDb({} as unknown as Parameters<typeof setDb>[0])
  setLogger({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} })
  setRealtime({ notify: notifyFn, subscribe: () => () => {} })
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
  beforeEach(() => __resetServicesForTests())
  afterEach(() => __resetServicesForTests())

  it('has stable id', () => {
    expect(sseObserver.id).toBe('agents:sse')
  })

  it('calls realtime.notify once per event', () => {
    const calls: Array<{ table: string; id?: string; action?: string }> = []
    installRealtime((p) => calls.push(p))

    const events: AgentEvent[] = [makeEvent('agent_start'), makeEvent('turn_start'), makeEvent('agent_end')]

    for (const event of events) {
      sseObserver.handle(event)
    }

    expect(calls).toHaveLength(3)
  })

  it('notify payload uses table=agent-sessions and conversationId as id', () => {
    const calls: Array<{ table: string; id?: string; action?: string }> = []
    installRealtime((p) => calls.push(p))

    sseObserver.handle(makeEvent('llm_call', 'my-conv'))

    expect(calls[0]).toMatchObject({
      table: 'agent-sessions',
      id: 'my-conv',
      action: 'llm_call',
    })
  })

  it('calls notify N times for N events', () => {
    const calls: Array<{ table: string; id?: string; action?: string }> = []
    installRealtime((p) => calls.push(p))

    const N = 7
    for (let i = 0; i < N; i++) {
      sseObserver.handle(makeEvent('message_update'))
    }

    expect(calls).toHaveLength(N)
  })
})
