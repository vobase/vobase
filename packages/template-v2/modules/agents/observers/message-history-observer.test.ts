/**
 * message-history-observer unit tests — no DB required.
 *
 * Validates:
 *   - Observer is a no-op on events other than turn_end.
 *   - On turn_end, inserts new messages past seqCursor.
 *   - seqCursor advances correctly across multiple turn_end events.
 *   - ON CONFLICT DO NOTHING (idempotency) — duplicate turn_end doesn't double-insert.
 *   - getMessages returning [] → observer is a no-op (hand-rolled loop mode).
 *   - initialSeq primes the cursor correctly for wakes resuming existing history.
 */

import { describe, expect, it } from 'bun:test'
import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { AgentEvent } from '@server/contracts/event'
import type { ObserverContext } from '@server/contracts/observer'
import { createMessageHistoryObserver } from './message-history-observer'

const dummyCtx = {} as ObserverContext

// ── Minimal stub db that captures insert/update calls ────────────────────────

interface InsertCapture {
  table: string
  values: unknown[]
  onConflictCalled: boolean
}

interface UpdateCapture {
  table: string
  set: Record<string, unknown>
}

function makeMockDb() {
  const inserts: InsertCapture[] = []
  const updates: UpdateCapture[] = []

  const db = {
    insert(table: { _: { name: string } } | unknown) {
      const tableName =
        typeof table === 'object' && table !== null && '_' in table
          ? ((table as { _: { name: string } })._.name ?? 'unknown')
          : 'unknown'
      const capture: InsertCapture = { table: tableName, values: [], onConflictCalled: false }
      inserts.push(capture)
      return {
        values(vals: unknown[]) {
          capture.values = vals
          return {
            onConflictDoNothing() {
              capture.onConflictCalled = true
              return Promise.resolve()
            },
          }
        },
      }
    },
    update(table: unknown) {
      const capture: UpdateCapture = { table: String(table), set: {} }
      updates.push(capture)
      return {
        set(vals: Record<string, unknown>) {
          capture.set = vals
          return {
            where() {
              return Promise.resolve()
            },
          }
        },
      }
    },
  }

  return { db: db as unknown as import('@server/contracts/scoped-db').ScopedDb, inserts, updates }
}

function turnEndEvent(turnIndex = 0): AgentEvent {
  return {
    type: 'turn_end',
    ts: new Date(),
    wakeId: 'w1',
    conversationId: 'c1',
    organizationId: 'o1',
    turnIndex,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
  }
}

function makeMessage(role: string, text: string): AgentMessage {
  return { role, content: [{ type: 'text', text }] } as unknown as AgentMessage
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createMessageHistoryObserver', () => {
  it('is a no-op on events other than turn_end', async () => {
    const { db, inserts } = makeMockDb()
    const obs = createMessageHistoryObserver({
      db,
      threadId: 'thread-1',
      getMessages: () => [makeMessage('user', 'hi')],
    })

    for (const type of ['agent_start', 'llm_call', 'message_start', 'agent_end'] as const) {
      await obs.handle(
        {
          type,
          ts: new Date(),
          wakeId: 'w1',
          conversationId: 'c1',
          organizationId: 'o1',
          turnIndex: 0,
        } as AgentEvent,
        dummyCtx,
      )
    }

    expect(inserts).toHaveLength(0)
  })

  it('getMessages returning [] → no-op on turn_end (hand-rolled loop shim)', async () => {
    const { db, inserts } = makeMockDb()
    const obs = createMessageHistoryObserver({
      db,
      threadId: 'thread-1',
      getMessages: () => [],
    })

    await obs.handle(turnEndEvent(), dummyCtx)
    expect(inserts).toHaveLength(0)
  })

  it('persists new messages on turn_end with correct seq values', async () => {
    const { db, inserts, updates } = makeMockDb()
    const messages: AgentMessage[] = [makeMessage('user', 'hello'), makeMessage('assistant', 'hi there')]
    const obs = createMessageHistoryObserver({
      db,
      threadId: 'thread-1',
      getMessages: () => messages,
    })

    await obs.handle(turnEndEvent(0), dummyCtx)

    // One insert (batch) and one update (thread stats)
    expect(inserts).toHaveLength(1)
    expect(updates).toHaveLength(1)
    expect(inserts[0]?.onConflictCalled).toBe(true)
    const rows = inserts[0]?.values as Array<{ seq: number; payload: unknown }>
    expect(rows).toHaveLength(2)
    expect(rows[0]?.seq).toBe(1)
    expect(rows[1]?.seq).toBe(2)
  })

  it('seqCursor advances: second turn_end only inserts new messages', async () => {
    const { db, inserts } = makeMockDb()
    const messages: AgentMessage[] = [makeMessage('user', 'turn0')]
    const obs = createMessageHistoryObserver({
      db,
      threadId: 'thread-1',
      getMessages: () => messages,
    })

    // Turn 0: 1 message persisted
    await obs.handle(turnEndEvent(0), dummyCtx)
    expect(inserts[0]?.values).toHaveLength(1)

    // Add a second message (turn 1)
    messages.push(makeMessage('assistant', 'turn1-reply'))

    // Turn 1: only the 1 new message is inserted
    await obs.handle(turnEndEvent(1), dummyCtx)
    expect(inserts).toHaveLength(2)
    expect(inserts[1]?.values).toHaveLength(1)
    const rows = inserts[1]?.values as Array<{ seq: number }>
    expect(rows[0]?.seq).toBe(2)
  })

  it('initialSeq primes cursor — resumes history from correct offset', async () => {
    const { db, inserts } = makeMockDb()
    // Simulates a wake where 3 messages already exist in DB
    const messages: AgentMessage[] = [
      makeMessage('user', 'old-1'),
      makeMessage('assistant', 'old-2'),
      makeMessage('user', 'old-3'),
      makeMessage('assistant', 'new-turn'), // Only this is new
    ]
    const obs = createMessageHistoryObserver({
      db,
      threadId: 'thread-1',
      getMessages: () => messages,
      initialSeq: 3, // 3 messages already persisted
    })

    await obs.handle(turnEndEvent(0), dummyCtx)

    // Only the 4th message (index 3) should be inserted
    expect(inserts).toHaveLength(1)
    const rows = inserts[0]?.values as Array<{ seq: number }>
    expect(rows).toHaveLength(1)
    expect(rows[0]?.seq).toBe(4) // seq = initialSeq + 1
  })
})
