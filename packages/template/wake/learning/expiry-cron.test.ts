/**
 * Integration tests for the learning-candidate expiry cron job.
 *
 * Requires a running Docker Postgres on :5432 (`docker compose up -d`).
 * Clears `agents.learning_candidates` in beforeEach for test isolation.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { MERIDIAN_ORG_ID, MERIGPT_AGENT_ID } from '@modules/agents/seed'
import {
  __resetLearningCandidatesServiceForTests,
  createLearningCandidatesService,
  type InsertLearningCandidateInput,
  insertCandidate,
  installLearningCandidatesService,
} from '@modules/agents/service/learning-candidates'
import { sql } from 'drizzle-orm'

import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '~/tests/helpers/test-db'
import { learningCandidateExpiryJob } from './expiry-cron'

// ─── Stub realtime ────────────────────────────────────────────────────────────

const stubRealtime = {
  async notify(_payload: { table: string; [k: string]: unknown }) {},
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

function baseInput(overrides: Partial<InsertLearningCandidateInput> = {}): InsertLearningCandidateInput {
  return {
    organizationId: MERIDIAN_ORG_ID,
    agentId: MERIGPT_AGENT_ID,
    conversationId: 'conv-expiry-test',
    signalKind: 'coaching_note',
    signalRef: 'ref-expiry-001',
    triageConfidence: 0.8,
    summary: 'Expiry cron test candidate.',
    context: 'Test context.',
    ...overrides,
  }
}

// ─── learningCandidateExpiryJob handler ──────────────────────────────────────

describe('learningCandidateExpiryJob', () => {
  it('sweeps an 8-day-old pending candidate to expired', async () => {
    const old = await insertCandidate(baseInput({ signalRef: 'old-expiry-ref' }))
    await dbh.db.execute(
      sql`UPDATE agents.learning_candidates SET created_at = now() - interval '8 days' WHERE id = ${old.id}`,
    )

    await learningCandidateExpiryJob.handler(undefined)

    const rows = await dbh.db.execute(sql`SELECT status FROM agents.learning_candidates WHERE id = ${old.id}`)
    expect(rows[0]?.status).toBe('expired')
  })

  it('leaves a 2-day-old pending candidate untouched', async () => {
    const recent = await insertCandidate(baseInput({ signalRef: 'recent-expiry-ref' }))
    await dbh.db.execute(
      sql`UPDATE agents.learning_candidates SET created_at = now() - interval '2 days' WHERE id = ${recent.id}`,
    )

    await learningCandidateExpiryJob.handler(undefined)

    const rows = await dbh.db.execute(sql`SELECT status FROM agents.learning_candidates WHERE id = ${recent.id}`)
    expect(rows[0]?.status).toBe('pending')
  })
})
