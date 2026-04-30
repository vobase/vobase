/**
 * Unit tests for the standalone wake-config public surface — the parts that
 * don't require booting the harness or mounting a workspace. Synthetic
 * conversationId derivation, trigger renderer, and brief side-load body.
 */

import { describe, expect, it } from 'bun:test'

import type { WakeTrigger } from './events'
import { standaloneConversationId } from './standalone'

describe('standaloneConversationId', () => {
  it('returns operator-<threadId> for operator_thread wakes', () => {
    expect(
      standaloneConversationId({
        organizationId: 'org1',
        triggerKind: 'operator_thread',
        threadId: 't_abc',
      }),
    ).toBe('operator-t_abc')
  })

  it('returns heartbeat-<scheduleId> for heartbeat wakes', () => {
    expect(
      standaloneConversationId({
        organizationId: 'org1',
        triggerKind: 'heartbeat',
        scheduleId: 'sch_xyz',
        intendedRunAt: new Date(),
      }),
    ).toBe('heartbeat-sch_xyz')
  })

  it('throws when operator_thread wake omits threadId', () => {
    expect(() => standaloneConversationId({ organizationId: 'org1', triggerKind: 'operator_thread' })).toThrow(
      /threadId required/,
    )
  })

  it('throws when heartbeat wake omits scheduleId', () => {
    expect(() => standaloneConversationId({ organizationId: 'org1', triggerKind: 'heartbeat' })).toThrow(
      /scheduleId required/,
    )
  })
})

describe('standalone wake trigger types', () => {
  it('operator_thread + heartbeat are part of the WakeTrigger union', () => {
    const ot: WakeTrigger = { trigger: 'operator_thread', threadId: 't1', messageIds: ['m1'] }
    const hb: WakeTrigger = {
      trigger: 'heartbeat',
      scheduleId: 's1',
      intendedRunAt: new Date('2026-04-26T10:00:00Z'),
      reason: 'cron 0 18 * * *',
    }
    expect(ot.trigger).toBe('operator_thread')
    expect(hb.trigger).toBe('heartbeat')
  })
})
