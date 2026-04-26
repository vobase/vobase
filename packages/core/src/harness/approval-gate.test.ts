import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { conversationEvents, pendingApprovals } from '../schemas/harness'
import { __resetApprovalGateForTests, createApprovalGate, installApprovalGate } from './approval-gate'
import { __resetJournalServiceForTests, installJournalService } from './journal'

interface PendingRow {
  id: string
  organizationId: string
  wakeId: string
  conversationId: string
  agentId: string
  turnIndex: number
  toolCallId: string
  toolName: string
  toolInput: unknown
  reason: string | null
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  decidedByUserId: string | null
  decidedNote: string | null
  requestedAt: Date
  decidedAt: Date | null
  expiresAt: Date
}

interface JournalRow {
  type: string
  conversationId: string
  organizationId: string
  wakeId: string | null
  turnIndex: number
  payload: Record<string, unknown>
}

function makeStubDb() {
  const rows: PendingRow[] = []
  const journals: JournalRow[] = []

  let predicateForUpdate: ((r: PendingRow) => boolean) | null = null
  let predicateForSelect: ((r: PendingRow) => boolean) | null = null

  const db = {
    insert(table: unknown) {
      return {
        values: (vals: Record<string, unknown>) => {
          if (table === pendingApprovals) {
            const merged = Object.assign(
              { id: `pa_${rows.length + 1}`, decidedByUserId: null, decidedNote: null, decidedAt: null },
              vals as Omit<PendingRow, 'id'>,
            ) as PendingRow
            rows.push(merged)
            return Promise.resolve()
          }
          if (table === conversationEvents) {
            const v = vals as Record<string, unknown>
            journals.push({
              type: v.type as string,
              conversationId: v.conversationId as string,
              organizationId: v.organizationId as string,
              wakeId: (v.wakeId as string | null) ?? null,
              turnIndex: v.turnIndex as number,
              payload: vals,
            })
            return Promise.resolve()
          }
          return Promise.resolve()
        },
      }
    },
    update(_table: unknown) {
      return {
        set: (patch: Partial<PendingRow>) => ({
          where: (predicate: ((r: PendingRow) => boolean) | unknown) => {
            const fn =
              predicateForUpdate ??
              (typeof predicate === 'function' ? (predicate as (r: PendingRow) => boolean) : () => true)
            predicateForUpdate = null
            for (const row of rows) {
              if (fn(row)) Object.assign(row, patch)
            }
            return Promise.resolve({ rowCount: rows.length })
          },
        }),
      }
    },
    select() {
      return {
        from: (_table: unknown) => {
          const filtered = rows.filter(predicateForSelect ?? (() => true))
          predicateForSelect = null
          const promise: unknown = Promise.resolve(filtered)
          ;(promise as { where: (predicate?: unknown) => unknown }).where = () => {
            const result = Promise.resolve(filtered)
            ;(result as { limit?: (n: number) => Promise<PendingRow[]> }).limit = (n: number) =>
              Promise.resolve(filtered.slice(0, n))
            return result as Promise<PendingRow[]> & { limit: (n: number) => Promise<PendingRow[]> }
          }
          return (promise as { where: (predicate?: unknown) => unknown }).where
        },
      }
    },
    setUpdatePredicate(fn: (r: PendingRow) => boolean) {
      predicateForUpdate = fn
    },
    setSelectPredicate(fn: (r: PendingRow) => boolean) {
      predicateForSelect = fn
    },
  }

  return { db, rows, journals }
}

const baseInput = {
  organizationId: 'o1',
  wakeId: 'w1',
  conversationId: 'c1',
  agentId: 'a1',
  turnIndex: 0,
  toolCallId: 'tc1',
  toolName: 'send_reply',
  toolInput: { text: 'hi' },
}

beforeEach(() => {
  __resetApprovalGateForTests()
  __resetJournalServiceForTests()
})

afterEach(() => {
  __resetApprovalGateForTests()
  __resetJournalServiceForTests()
})

describe('approval-gate', () => {
  it('persists pending row + journals approval_requested + wake_state_changed', async () => {
    const { db, rows, journals } = makeStubDb()
    installJournalService({
      append: (input) => {
        const ev = input.event as { type: string }
        journals.push({
          type: ev.type,
          conversationId: input.conversationId,
          organizationId: input.organizationId,
          wakeId: input.wakeId ?? null,
          turnIndex: input.turnIndex,
          payload: input as unknown as Record<string, unknown>,
        })
        return Promise.resolve()
      },
      getLastWakeTail: () => Promise.resolve({ interrupted: false }),
      getLatestTurnIndex: () => Promise.resolve(0),
    })
    installApprovalGate(createApprovalGate({ db: db as unknown as Parameters<typeof createApprovalGate>[0]['db'] }))

    const now = new Date('2026-04-26T10:00:00Z')
    const { requestApproval } = createApprovalGate({
      db: db as unknown as Parameters<typeof createApprovalGate>[0]['db'],
    })
    await requestApproval({ ...baseInput, reason: 'high blast radius', now: () => now })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('pending')
    expect(rows[0]?.expiresAt.getTime() - now.getTime()).toBe(24 * 60 * 60 * 1000)
    expect(rows[0]?.toolName).toBe('send_reply')

    const types = journals.map((j) => j.type)
    expect(types).toContain('approval_requested')
    expect(types).toContain('wake_state_changed')
    const stateChange = journals.find((j) => j.type === 'wake_state_changed')
    expect((stateChange?.payload.event as { from: string; to: string }).from).toBe('running')
    expect((stateChange?.payload.event as { from: string; to: string }).to).toBe('pending_approval')
  })

  it('resolveApproval flips status, journals approval_resolved + state to awaiting_resume', async () => {
    const { db, rows, journals } = makeStubDb()
    installJournalService({
      append: (input) => {
        const ev = input.event as { type: string }
        journals.push({
          type: ev.type,
          conversationId: input.conversationId,
          organizationId: input.organizationId,
          wakeId: input.wakeId ?? null,
          turnIndex: input.turnIndex,
          payload: input as unknown as Record<string, unknown>,
        })
        return Promise.resolve()
      },
      getLastWakeTail: () => Promise.resolve({ interrupted: false }),
      getLatestTurnIndex: () => Promise.resolve(0),
    })
    const gate = createApprovalGate({ db: db as unknown as Parameters<typeof createApprovalGate>[0]['db'] })

    await gate.requestApproval({ ...baseInput, now: () => new Date('2026-04-26T10:00:00Z') })
    journals.length = 0
    db.setUpdatePredicate((r) => r.wakeId === 'w1' && r.toolCallId === 'tc1')

    await gate.resolveApproval({
      ...baseInput,
      decision: 'approved',
      decidedByUserId: 'u1',
      note: 'looks fine',
      now: () => new Date('2026-04-26T10:05:00Z'),
    })

    expect(rows[0]?.status).toBe('approved')
    expect(rows[0]?.decidedByUserId).toBe('u1')
    expect(rows[0]?.decidedNote).toBe('looks fine')
    const types = journals.map((j) => j.type)
    expect(types).toContain('approval_resolved')
    const stateChange = journals.find((j) => j.type === 'wake_state_changed')
    expect((stateChange?.payload.event as { from: string; to: string }).to).toBe('awaiting_resume')
  })

  it('expireApproval flips status to expired and emits aborted state-change', async () => {
    const { db, rows, journals } = makeStubDb()
    installJournalService({
      append: (input) => {
        const ev = input.event as { type: string }
        journals.push({
          type: ev.type,
          conversationId: input.conversationId,
          organizationId: input.organizationId,
          wakeId: input.wakeId ?? null,
          turnIndex: input.turnIndex,
          payload: input as unknown as Record<string, unknown>,
        })
        return Promise.resolve()
      },
      getLastWakeTail: () => Promise.resolve({ interrupted: false }),
      getLatestTurnIndex: () => Promise.resolve(0),
    })
    const gate = createApprovalGate({ db: db as unknown as Parameters<typeof createApprovalGate>[0]['db'] })
    await gate.requestApproval({ ...baseInput, now: () => new Date('2026-04-26T10:00:00Z') })
    journals.length = 0
    db.setUpdatePredicate((r) => r.wakeId === 'w1' && r.toolCallId === 'tc1')
    await gate.expireApproval({ ...baseInput, now: () => new Date('2026-04-27T11:00:00Z') })

    expect(rows[0]?.status).toBe('expired')
    const stateChange = journals.find((j) => j.type === 'wake_state_changed')
    expect((stateChange?.payload.event as { from: string; to: string }).to).toBe('aborted')
  })
})
