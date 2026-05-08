/**
 * Tests for dismissCandidateTool.
 *
 * Requires a running Docker Postgres on :5432 (`docker compose up -d`).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { MERIDIAN_ORG_ID, MERIGPT_AGENT_ID } from '@modules/agents/seed'
import type { ToolContext } from '@vobase/core'
import { sql } from 'drizzle-orm'

import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '~/tests/helpers/test-db'
import {
  __resetLearningCandidatesServiceForTests,
  createLearningCandidatesService,
  type InsertLearningCandidateInput,
  insertCandidate,
  installLearningCandidatesService,
  listPendingForConversation,
} from '../service/learning-candidates'
import { dismissCandidateTool } from './dismiss-candidate'

// ─── Stub realtime ────────────────────────────────────────────────────────────

const stubRealtime = {
  async notify(_payload: unknown) {},
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
  await dbh.db.execute(sql`TRUNCATE agents.learning_candidates CASCADE`)
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CONV_A = 'conv-dismiss-test-A'

function baseInput(overrides: Partial<InsertLearningCandidateInput> = {}): InsertLearningCandidateInput {
  return {
    organizationId: MERIDIAN_ORG_ID,
    agentId: MERIGPT_AGENT_ID,
    conversationId: CONV_A,
    signalKind: 'coaching_note',
    signalRef: 'msg-ref-dismiss-001',
    triageConfidence: 0.7,
    summary: 'Customer asked about redundant topic.',
    context: 'Full conversation context here.',
    ...overrides,
  }
}

const mockCtx: ToolContext = {
  organizationId: MERIDIAN_ORG_ID,
  agentId: MERIGPT_AGENT_ID,
  conversationId: CONV_A,
  wakeId: 'wake-test-001',
  turnIndex: 0,
  toolCallId: 'tool-call-test-001',
}

// ─── dismissCandidateTool ─────────────────────────────────────────────────────

describe('dismissCandidateTool', () => {
  it('marks the candidate as dismissed with the supplied reason', async () => {
    const row = await insertCandidate(baseInput())

    const result = await dismissCandidateTool.execute(
      { candidateId: row.id, reason: 'duplicate of existing memory' },
      mockCtx,
    )

    expect(result.ok).toBe(true)

    const rows = await dbh.db.execute(
      sql`SELECT status, dismissed_reason FROM agents.learning_candidates WHERE id = ${row.id}`,
    )
    expect(rows[0]?.status).toBe('dismissed')
    expect(rows[0]?.dismissed_reason).toBe('duplicate of existing memory')
  })

  it('dismissed candidate is excluded from listPendingForConversation', async () => {
    const kept = await insertCandidate(baseInput({ signalRef: 'ref-kept' }))
    const dismissed = await insertCandidate(baseInput({ signalRef: 'ref-dismissed' }))

    await dismissCandidateTool.execute({ candidateId: dismissed.id, reason: 'off-topic' }, mockCtx)

    const pending = await listPendingForConversation(MERIDIAN_ORG_ID, MERIGPT_AGENT_ID, CONV_A)
    const ids = pending.map((r) => r.id)
    expect(ids).toContain(kept.id)
    expect(ids).not.toContain(dismissed.id)
  })

  it('calling dismiss on an already-dismissed candidate does not throw', async () => {
    const row = await insertCandidate(baseInput())

    await dismissCandidateTool.execute({ candidateId: row.id, reason: 'first dismiss' }, mockCtx)

    // Second call: row is no longer pending, WHERE clause matches nothing — no-op
    const result = await dismissCandidateTool.execute({ candidateId: row.id, reason: 'second dismiss' }, mockCtx)
    expect(result.ok).toBe(true)

    // Status and original reason unchanged
    const rows = await dbh.db.execute(
      sql`SELECT status, dismissed_reason FROM agents.learning_candidates WHERE id = ${row.id}`,
    )
    expect(rows[0]?.status).toBe('dismissed')
    expect(rows[0]?.dismissed_reason).toBe('first dismiss')
  })
})
