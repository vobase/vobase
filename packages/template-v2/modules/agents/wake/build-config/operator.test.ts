/**
 * Unit tests for the operator wake-config public surface — the parts that
 * don't require booting the harness or mounting a workspace. Synthetic
 * conversationId derivation, trigger renderer, and brief side-load body.
 *
 * Full-stack operator wake e2e (real DB, real cron-tick fire, real harness)
 * lands in §10.11.
 */

import { describe, expect, it } from 'bun:test'
import type { WakeTrigger } from '@modules/agents/events'

import { operatorConversationId } from './operator'

describe('operatorConversationId', () => {
  it('returns operator-<threadId> for operator_thread wakes', () => {
    expect(
      operatorConversationId({
        organizationId: 'org1',
        triggerKind: 'operator_thread',
        threadId: 't_abc',
      }),
    ).toBe('operator-t_abc')
  })

  it('returns heartbeat-<scheduleId> for heartbeat wakes', () => {
    expect(
      operatorConversationId({
        organizationId: 'org1',
        triggerKind: 'heartbeat',
        scheduleId: 'sch_xyz',
        intendedRunAt: new Date(),
      }),
    ).toBe('heartbeat-sch_xyz')
  })

  it('throws when operator_thread wake omits threadId', () => {
    expect(() => operatorConversationId({ organizationId: 'org1', triggerKind: 'operator_thread' })).toThrow(
      /threadId required/,
    )
  })

  it('throws when heartbeat wake omits scheduleId', () => {
    expect(() => operatorConversationId({ organizationId: 'org1', triggerKind: 'heartbeat' })).toThrow(
      /scheduleId required/,
    )
  })
})

describe('operator wake trigger types', () => {
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
