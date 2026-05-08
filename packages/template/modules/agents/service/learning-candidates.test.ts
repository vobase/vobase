/**
 * Integration tests for learning-candidates service.
 *
 * Requires a running Docker Postgres on :5432 (`docker compose up -d`).
 * Each test group clears `agents.learning_candidates` in beforeEach so tests
 * are independent of seed data but do rely on the seeded org + agent rows.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { MERIDIAN_ORG_ID, MERIGPT_AGENT_ID } from '@modules/agents/seed'
import { sql } from 'drizzle-orm'

import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '~/tests/helpers/test-db'
import {
  __resetLearningCandidatesServiceForTests,
  countPendingOtherConversations,
  createLearningCandidatesService,
  type InsertLearningCandidateInput,
  insertCandidate,
  installLearningCandidatesService,
  listPendingForConversation,
  markConsumed,
  markDismissed,
  sweepExpired,
} from './learning-candidates'

// ─── Stub realtime ────────────────────────────────────────────────────────────

interface CapturedNotify {
  table: string
  action?: string
  [k: string]: unknown
}

let captured: CapturedNotify[] = []

const stubRealtime = {
  async notify(payload: CapturedNotify) {
    captured.push(payload)
  },
  subscribe(_fn: (payload: string) => void): () => void {
    return () => {}
  },
  async shutdown() {},
}

// ─── Harness ──────────────────────────────────────────────────────────────────

let dbh: TestDbHandle

beforeAll(async () => {
  await resetAndSeedDb()
  dbh = connectTestDb()
  installLearningCandidatesService(
    createLearningCandidatesService({
      db: dbh.db as unknown as Parameters<typeof createLearningCandidatesService>[0]['db'],
      realtime: stubRealtime,
    }),
  )
}, 60_000)

afterAll(async () => {
  __resetLearningCandidatesServiceForTests()
  await dbh.teardown()
})

beforeEach(async () => {
  captured = []
  await dbh.db.execute(sql`TRUNCATE agents.learning_candidates CASCADE`)
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CONV_A = 'conv-test-A'
const CONV_B = 'conv-test-B'

function baseInput(overrides: Partial<InsertLearningCandidateInput> = {}): InsertLearningCandidateInput {
  return {
    organizationId: MERIDIAN_ORG_ID,
    agentId: MERIGPT_AGENT_ID,
    conversationId: CONV_A,
    signalKind: 'coaching_note',
    signalRef: 'msg-ref-001',
    triageConfidence: 0.75,
    summary: 'Customer asked about Slack integration filters.',
    context: 'Full conversation context here.',
    ...overrides,
  }
}

// ─── insertCandidate ──────────────────────────────────────────────────────────

describe('insertCandidate', () => {
  it('inserts a row and returns expected fields', async () => {
    const row = await insertCandidate(baseInput())

    expect(row.id).toBeTruthy()
    expect(row.organizationId).toBe(MERIDIAN_ORG_ID)
    expect(row.agentId).toBe(MERIGPT_AGENT_ID)
    expect(row.conversationId).toBe(CONV_A)
    expect(row.signalKind).toBe('coaching_note')
    expect(row.signalRef).toBe('msg-ref-001')
    expect(row.triageConfidence).toBe(0.75)
    expect(row.summary).toBe('Customer asked about Slack integration filters.')
    expect(row.status).toBe('pending')
    expect(row.createdAt).toBeInstanceOf(Date)

    // Verify the row is persisted in DB
    const rows = await dbh.db.execute(sql`SELECT id FROM agents.learning_candidates WHERE id = ${row.id}`)
    expect(rows.length).toBe(1)
  })

  it('emits a realtime notify with table=learning_candidates, action=inserted', async () => {
    await insertCandidate(baseInput())

    expect(captured.length).toBe(1)
    expect(captured[0]?.table).toBe('learning_candidates')
    expect(captured[0]?.action).toBe('inserted')
  })

  it('throws on triageConfidence = -0.1 (below 0)', async () => {
    await expect(insertCandidate(baseInput({ triageConfidence: -0.1 }))).rejects.toThrow(
      'triageConfidence must be between 0 and 1',
    )
  })

  it('throws on triageConfidence = 1.5 (above 1)', async () => {
    await expect(insertCandidate(baseInput({ triageConfidence: 1.5 }))).rejects.toThrow(
      'triageConfidence must be between 0 and 1',
    )
  })

  it('throws on empty summary', async () => {
    await expect(insertCandidate(baseInput({ summary: '' }))).rejects.toThrow('summary is required')
  })
})

// ─── listPendingForConversation ───────────────────────────────────────────────

describe('listPendingForConversation', () => {
  it('returns rows in created_at DESC order', async () => {
    const r1 = await insertCandidate(baseInput({ summary: 'First' }))
    await Bun.sleep(15)
    const r2 = await insertCandidate(baseInput({ summary: 'Second' }))
    await Bun.sleep(15)
    const r3 = await insertCandidate(baseInput({ summary: 'Third' }))

    const rows = await listPendingForConversation(MERIDIAN_ORG_ID, MERIGPT_AGENT_ID, CONV_A)
    expect(rows.map((r) => r.id)).toEqual([r3.id, r2.id, r1.id])
  })

  it('caps at candidateSideLoadCap (5) by default when 7 rows inserted', async () => {
    for (let i = 0; i < 7; i++) {
      await insertCandidate(baseInput({ summary: `Candidate ${i}`, signalRef: `ref-${i}` }))
    }
    const rows = await listPendingForConversation(MERIDIAN_ORG_ID, MERIGPT_AGENT_ID, CONV_A)
    expect(rows.length).toBe(5)
  })

  it('respects explicit limit', async () => {
    for (let i = 0; i < 7; i++) {
      await insertCandidate(baseInput({ summary: `Candidate ${i}`, signalRef: `ref-${i}` }))
    }
    const rows = await listPendingForConversation(MERIDIAN_ORG_ID, MERIGPT_AGENT_ID, CONV_A, 3)
    expect(rows.length).toBe(3)
  })

  it('only returns pending rows for the specified conversation', async () => {
    await insertCandidate(baseInput({ conversationId: CONV_A }))
    await insertCandidate(baseInput({ conversationId: CONV_B }))

    const rowsA = await listPendingForConversation(MERIDIAN_ORG_ID, MERIGPT_AGENT_ID, CONV_A)
    expect(rowsA.length).toBe(1)
    expect(rowsA[0]?.conversationId).toBe(CONV_A)
  })
})

// ─── countPendingOtherConversations ──────────────────────────────────────────

describe('countPendingOtherConversations', () => {
  it('counts pending rows belonging to OTHER conversations', async () => {
    // Insert 2 in conv-A, 3 in conv-B
    await insertCandidate(baseInput({ conversationId: CONV_A, signalRef: 'a1' }))
    await insertCandidate(baseInput({ conversationId: CONV_A, signalRef: 'a2' }))
    await insertCandidate(baseInput({ conversationId: CONV_B, signalRef: 'b1' }))
    await insertCandidate(baseInput({ conversationId: CONV_B, signalRef: 'b2' }))
    await insertCandidate(baseInput({ conversationId: CONV_B, signalRef: 'b3' }))

    const fromA = await countPendingOtherConversations(MERIDIAN_ORG_ID, MERIGPT_AGENT_ID, CONV_A)
    expect(fromA).toBe(3)

    const fromB = await countPendingOtherConversations(MERIDIAN_ORG_ID, MERIGPT_AGENT_ID, CONV_B)
    expect(fromB).toBe(2)
  })
})

// ─── markConsumed ─────────────────────────────────────────────────────────────

describe('markConsumed', () => {
  it('flips status to consumed and sets consumed_by_proposal_id', async () => {
    const row = await insertCandidate(baseInput())
    await markConsumed(row.id, 'prop-001')

    const rows = await dbh.db.execute(
      sql`SELECT status, consumed_by_proposal_id FROM agents.learning_candidates WHERE id = ${row.id}`,
    )
    expect(rows[0]?.status).toBe('consumed')
    expect(rows[0]?.consumed_by_proposal_id).toBe('prop-001')
  })

  it('calling markConsumed twice does not throw and does not re-flip a consumed row', async () => {
    const row = await insertCandidate(baseInput())
    await markConsumed(row.id, 'prop-001')
    // Second call: row is already consumed (not pending), so WHERE clause matches nothing — no-op
    await expect(markConsumed(row.id, 'prop-002')).resolves.toBeUndefined()

    const rows = await dbh.db.execute(
      sql`SELECT consumed_by_proposal_id FROM agents.learning_candidates WHERE id = ${row.id}`,
    )
    // proposal id stays as the first one
    expect(rows[0]?.consumed_by_proposal_id).toBe('prop-001')
  })
})

// ─── markDismissed ────────────────────────────────────────────────────────────

describe('markDismissed', () => {
  it('flips status to dismissed and sets dismissed_reason', async () => {
    const row = await insertCandidate(baseInput())
    await markDismissed(row.id, 'not relevant to current policy')

    const rows = await dbh.db.execute(
      sql`SELECT status, dismissed_reason FROM agents.learning_candidates WHERE id = ${row.id}`,
    )
    expect(rows[0]?.status).toBe('dismissed')
    expect(rows[0]?.dismissed_reason).toBe('not relevant to current policy')
  })

  it('does not change a row that is already consumed', async () => {
    const row = await insertCandidate(baseInput())
    await markConsumed(row.id, 'prop-xyz')
    // markDismissed is a no-op when status != 'pending'
    await expect(markDismissed(row.id, 'trying to dismiss consumed row')).resolves.toBeUndefined()

    const rows = await dbh.db.execute(sql`SELECT status FROM agents.learning_candidates WHERE id = ${row.id}`)
    expect(rows[0]?.status).toBe('consumed')
  })
})

// ─── sweepExpired ─────────────────────────────────────────────────────────────

describe('sweepExpired', () => {
  it('marks rows older than the cutoff as expired and returns the count', async () => {
    const old = await insertCandidate(baseInput({ signalRef: 'old-ref' }))
    // Back-date to 8 days ago
    await dbh.db.execute(
      sql`UPDATE agents.learning_candidates SET created_at = now() - interval '8 days' WHERE id = ${old.id}`,
    )

    const count = await sweepExpired(7)
    expect(count).toBe(1)

    const rows = await dbh.db.execute(sql`SELECT status FROM agents.learning_candidates WHERE id = ${old.id}`)
    expect(rows[0]?.status).toBe('expired')
  })

  it('leaves rows younger than the cutoff as pending', async () => {
    const recent = await insertCandidate(baseInput({ signalRef: 'recent-ref' }))
    // Back-date to only 2 days ago
    await dbh.db.execute(
      sql`UPDATE agents.learning_candidates SET created_at = now() - interval '2 days' WHERE id = ${recent.id}`,
    )

    const count = await sweepExpired(7)
    expect(count).toBe(0)

    const rows = await dbh.db.execute(sql`SELECT status FROM agents.learning_candidates WHERE id = ${recent.id}`)
    expect(rows[0]?.status).toBe('pending')
  })

  it('only sweeps one when old and recent coexist', async () => {
    const old = await insertCandidate(baseInput({ signalRef: 'old-2' }))
    const recent = await insertCandidate(baseInput({ signalRef: 'recent-2' }))

    await dbh.db.execute(
      sql`UPDATE agents.learning_candidates SET created_at = now() - interval '8 days' WHERE id = ${old.id}`,
    )
    await dbh.db.execute(
      sql`UPDATE agents.learning_candidates SET created_at = now() - interval '2 days' WHERE id = ${recent.id}`,
    )

    const count = await sweepExpired(7)
    expect(count).toBe(1)

    const expiredRows = await dbh.db.execute(sql`SELECT id FROM agents.learning_candidates WHERE status = 'expired'`)
    expect(expiredRows.length).toBe(1)
    expect(expiredRows[0]?.id).toBe(old.id)
  })
})
