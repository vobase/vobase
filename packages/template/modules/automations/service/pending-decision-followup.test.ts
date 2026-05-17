/**
 * Unit tests for `computeFollowupActions` — the pure decision function
 * driving US-010's pending-decision follow-up cron.
 */
import { describe, expect, it } from 'bun:test'

import { computeFollowupActions, MAX_REPINGS, type PendingRow } from './pending-decision-followup'

const NOW = new Date('2026-05-17T12:00:00Z')

function row(overrides: Partial<PendingRow> = {}): PendingRow {
  return {
    id: 'pnd0test001',
    kind: 'approval',
    conversationId: 'cnv0test001',
    createdAt: new Date(NOW.getTime() - 5 * 60_000), // 5 min ago
    assigneeStaffUserId: 'usr0alice00',
    filedByAgentId: 'agt0meri0v1',
    followupAttempt: 0,
    ...overrides,
  }
}

describe('computeFollowupActions', () => {
  it('sub-1h, attempt=0 → reping at attempt=1', () => {
    const actions = computeFollowupActions(NOW, [row({ followupAttempt: 0 })])
    expect(actions).toEqual([
      {
        type: 'reping',
        pendingId: 'pnd0test001',
        kind: 'approval',
        staffUserId: 'usr0alice00',
        conversationId: 'cnv0test001',
        attempt: 1,
      },
    ])
  })

  it('sub-1h, attempt=5 → reping at attempt=6 (last allowed)', () => {
    const actions = computeFollowupActions(NOW, [row({ followupAttempt: 5 })])
    expect(actions[0]).toMatchObject({ type: 'reping', attempt: 6 })
  })

  it('sub-1h, attempt=MAX_REPINGS → cap_reached (no more pings)', () => {
    const actions = computeFollowupActions(NOW, [row({ followupAttempt: MAX_REPINGS })])
    expect(actions).toEqual([{ type: 'cap_reached', pendingId: 'pnd0test001' }])
  })

  it('sub-1h, attempt > MAX_REPINGS → cap_reached', () => {
    const actions = computeFollowupActions(NOW, [row({ followupAttempt: MAX_REPINGS + 3 })])
    expect(actions[0]).toEqual({ type: 'cap_reached', pendingId: 'pnd0test001' })
  })

  it('70-minute-old row → timeout_note with formatted body', () => {
    const stale = row({ createdAt: new Date(NOW.getTime() - 70 * 60_000), followupAttempt: 4 })
    const actions = computeFollowupActions(NOW, [stale])
    expect(actions).toEqual([
      {
        type: 'timeout_note',
        pendingId: 'pnd0test001',
        conversationId: 'cnv0test001',
        bodyText: '⏱ Approval #pnd0test001 pending 1h+ — no response on WhatsApp',
      },
    ])
  })

  it('70-minute-old proposal → timeout_note labelled "Proposal"', () => {
    const stale = row({
      id: 'cpr0prop001',
      kind: 'proposal',
      createdAt: new Date(NOW.getTime() - 70 * 60_000),
    })
    const actions = computeFollowupActions(NOW, [stale])
    expect(actions[0]).toMatchObject({
      type: 'timeout_note',
      bodyText: '⏱ Proposal #cpr0prop001 pending 1h+ — no response on WhatsApp',
    })
  })

  it('exactly 1h-old row → timeout_note (>= boundary)', () => {
    const onHourBoundary = row({ createdAt: new Date(NOW.getTime() - 60 * 60_000) })
    const actions = computeFollowupActions(NOW, [onHourBoundary])
    expect(actions[0]?.type).toBe('timeout_note')
  })

  it('returns one action per input row, in order', () => {
    const rows = [
      row({ id: 'a', followupAttempt: 0 }),
      row({ id: 'b', followupAttempt: MAX_REPINGS }),
      row({ id: 'c', createdAt: new Date(NOW.getTime() - 90 * 60_000) }),
    ]
    const actions = computeFollowupActions(NOW, rows)
    expect(actions).toHaveLength(3)
    expect(actions[0]?.type).toBe('reping')
    expect(actions[1]?.type).toBe('cap_reached')
    expect(actions[2]?.type).toBe('timeout_note')
  })

  it('empty input → empty output', () => {
    expect(computeFollowupActions(NOW, [])).toEqual([])
  })
})

/*
 * Caller responsibility — NOT tested here:
 *   - Idempotency: 70-minute-old row with a prior `timeout_note` already
 *     recorded must NOT emit a second `timeout_note`. The dispatcher
 *     (US-013) reads `audit_log` for an existing row keyed by
 *     `(event='automations.timeout_note', target_id=<pendingId>:timeout-note)`
 *     BEFORE acting on this function's output, and skips the action when
 *     present. The function itself is intentionally stateless — feeding it
 *     the same `(now, rows)` twice yields identical actions.
 */
