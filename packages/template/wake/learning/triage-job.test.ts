/**
 * Integration tests for the learning:triage job handler.
 *
 * Requires a running Docker Postgres on :5432 (`docker compose up -d`).
 * No real LLM key needed — `shouldStubTriage()` activates when OPENAI_API_KEY
 * and BIFROST_API_KEY are both unset, producing deterministic stub output.
 *
 * Stub rules (from triage-prompt.ts):
 *   - body stripped of leading "@<agentName>", trimmed length < 20 → worth_attention: false
 *   - body trimmed length >= 20 → worth_attention: true
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { MERIDIAN_ORG_ID, MERIGPT_AGENT_ID } from '@modules/agents/seed'
import {
  __resetLearningCandidatesServiceForTests,
  createLearningCandidatesService,
  installLearningCandidatesService,
} from '@modules/agents/service/learning-candidates'
import { sql } from 'drizzle-orm'

import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '~/tests/helpers/test-db'
import {
  __resetTriageDepsForTests,
  handleTriageJobForTest,
  installTriageDeps,
  type LearningTriageJobPayload,
} from './triage-job'

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

const CONV_A = 'conv-triage-test-A'

beforeAll(async () => {
  await resetAndSeedDb()
  dbh = connectTestDb()
  installLearningCandidatesService(
    createLearningCandidatesService({
      db: dbh.db as unknown as Parameters<typeof createLearningCandidatesService>[0]['db'],
      realtime: stubRealtime,
    }),
  )
  installTriageDeps({ db: dbh.db as unknown as Parameters<typeof installTriageDeps>[0]['db'] })
}, 60_000)

afterAll(async () => {
  __resetLearningCandidatesServiceForTests()
  __resetTriageDepsForTests()
  await dbh.teardown()
})

beforeEach(async () => {
  await dbh.db.execute(sql`TRUNCATE agents.learning_candidates CASCADE`)
})

// ─── Helper ───────────────────────────────────────────────────────────────────

function makePayload(overrides: Partial<LearningTriageJobPayload> = {}): LearningTriageJobPayload {
  return {
    organizationId: MERIDIAN_ORG_ID,
    agentId: MERIGPT_AGENT_ID,
    conversationId: CONV_A,
    signal: {
      kind: 'coaching_note',
      noteId: 'note-001',
      body: 'This is a substantive coaching note with enough length.',
    },
    ...overrides,
  }
}

async function countCandidates(): Promise<number> {
  const rows = await dbh.db.execute(sql`SELECT COUNT(*) AS n FROM agents.learning_candidates`)
  return Number(rows[0]?.n ?? 0)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('learning:triage job handler', () => {
  it('short signal (@MeriGPT hi) → zero rows inserted', async () => {
    const payload = makePayload({
      signal: { kind: 'coaching_note', noteId: 'note-short', body: '@MeriGPT hi' },
    })
    await handleTriageJobForTest(payload)
    expect(await countCandidates()).toBe(0)
  })

  it('substantive signal (50+ chars) → one pending row with matching signal_kind and triage_confidence > 0', async () => {
    const body = 'When a customer asks about billing cycles, always clarify the pro-rata adjustment before quoting.'
    const payload = makePayload({
      signal: { kind: 'staff_takeover', messageId: 'msg-001', body },
    })
    await handleTriageJobForTest(payload)
    const rows = await dbh.db.execute(
      sql`SELECT signal_kind, triage_confidence, status FROM agents.learning_candidates`,
    )
    expect(rows.length).toBe(1)
    expect(rows[0]?.signal_kind).toBe('staff_takeover')
    expect(Number(rows[0]?.triage_confidence)).toBeGreaterThan(0)
    expect(rows[0]?.status).toBe('pending')
  })

  describe('debounce', () => {
    it('within debounce window → second call adds no new row', async () => {
      // Seed an existing candidate 1 minute ago
      await dbh.db.execute(
        sql`INSERT INTO agents.learning_candidates
          (id, organization_id, agent_id, conversation_id, signal_kind, signal_ref,
           triage_confidence, summary, context, status, created_at, updated_at)
          VALUES
          ('seed-deb-01', ${MERIDIAN_ORG_ID}, ${MERIGPT_AGENT_ID}, ${CONV_A}, 'coaching_note', 'note-seed',
           0.5, 'Seed candidate', 'Seed context', 'pending',
           now() - interval '1 minute', now() - interval '1 minute')`,
      )

      const body = 'Another substantive coaching note that exceeds the twenty character threshold.'
      const payload = makePayload({
        signal: { kind: 'coaching_note', noteId: 'note-002', body },
      })
      await handleTriageJobForTest(payload)

      // Still only the seeded row — debounce fired
      expect(await countCandidates()).toBe(1)
    })

    it('after debounce window expires → new row inserted', async () => {
      // Seed a candidate 6 minutes ago (past the 5-min window)
      await dbh.db.execute(
        sql`INSERT INTO agents.learning_candidates
          (id, organization_id, agent_id, conversation_id, signal_kind, signal_ref,
           triage_confidence, summary, context, status, created_at, updated_at)
          VALUES
          ('seed-deb-02', ${MERIDIAN_ORG_ID}, ${MERIGPT_AGENT_ID}, ${CONV_A}, 'coaching_note', 'note-seed-old',
           0.5, 'Old seed candidate', 'Old seed context', 'pending',
           now() - interval '6 minutes', now() - interval '6 minutes')`,
      )

      const body = 'Substantive coaching note after debounce has elapsed, long enough to pass triage.'
      const payload = makePayload({
        signal: { kind: 'coaching_note', noteId: 'note-003', body },
      })
      await handleTriageJobForTest(payload)

      // Now there should be two rows: the seeded one + the new one
      expect(await countCandidates()).toBe(2)
    })
  })
})
