/**
 * Unit tests for learningCandidatesSideLoadContributor.
 *
 * Requires a running Docker Postgres on :5432 (`docker compose up -d`).
 * Each test group truncates `agents.learning_candidates` in beforeEach.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { MERIDIAN_ORG_ID, MERIGPT_AGENT_ID } from '@modules/agents/seed'
import type { SideLoadCtx } from '@vobase/core'
import { sql } from 'drizzle-orm'

import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '~/tests/helpers/test-db'
import {
  __resetLearningCandidatesServiceForTests,
  createLearningCandidatesService,
  type InsertLearningCandidateInput,
  insertCandidate,
  installLearningCandidatesService,
} from './learning-candidates'
import { learningCandidatesSideLoadContributor } from './learning-candidates-sideload'

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

const CONV_A = 'conv-sl-A'
const CONV_B = 'conv-sl-B'
const AGENT_B = 'agent-other-B'

function makeCtx(overrides: Partial<SideLoadCtx> = {}): SideLoadCtx {
  return {
    organizationId: MERIDIAN_ORG_ID,
    agentId: MERIGPT_AGENT_ID,
    conversationId: CONV_A,
    contactId: '',
    turnIndex: 0,
    ...overrides,
  }
}

function baseInput(overrides: Partial<InsertLearningCandidateInput> = {}): InsertLearningCandidateInput {
  return {
    organizationId: MERIDIAN_ORG_ID,
    agentId: MERIGPT_AGENT_ID,
    conversationId: CONV_A,
    signalKind: 'coaching_note',
    signalRef: 'ref-sl-001',
    triageConfidence: 0.8,
    summary: 'Test summary for sideload.',
    context: 'Context text.',
    ...overrides,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('learningCandidatesSideLoadContributor', () => {
  describe('empty — zero pending everywhere', () => {
    it('returns [] when no candidates exist', async () => {
      const result = await learningCandidatesSideLoadContributor(makeCtx())
      expect(result).toEqual([])
    })
  })

  describe('3 candidates in current conversation', () => {
    it('renders all 3 candidate ids, summaries, and scope hints', async () => {
      const c1 = await insertCandidate(
        baseInput({ summary: 'Summary one', scopeHint: 'agents.agent_memory', signalRef: 'r1' }),
      )
      const c2 = await insertCandidate(
        baseInput({ summary: 'Summary two', scopeHint: 'contacts.contact_memory', signalRef: 'r2' }),
      )
      const c3 = await insertCandidate(baseInput({ summary: 'Summary three', scopeHint: null, signalRef: 'r3' }))

      const result = await learningCandidatesSideLoadContributor(makeCtx())
      expect(result.length).toBe(1)

      const rendered = result[0]?.render()
      expect(rendered).toContain(c1.id)
      expect(rendered).toContain(c2.id)
      expect(rendered).toContain(c3.id)
      expect(rendered).toContain('Summary one')
      expect(rendered).toContain('Summary two')
      expect(rendered).toContain('Summary three')
      expect(rendered).toContain('agents.agent_memory')
      expect(rendered).toContain('contacts.contact_memory')
      // No "other conversations" footer when otherCount === 0
      expect(rendered).not.toContain('from other conversations')
    })
  })

  describe('7 candidates in current conversation — cap=5', () => {
    it('surfaces exactly 5 candidates (newest-first)', async () => {
      for (let i = 0; i < 7; i++) {
        await insertCandidate(baseInput({ summary: `Candidate ${i}`, signalRef: `r-cap-${i}` }))
        // Small sleep so created_at ordering is stable
        await Bun.sleep(10)
      }

      const result = await learningCandidatesSideLoadContributor(makeCtx())
      expect(result.length).toBe(1)

      const rendered = result[0]?.render()
      // Should list exactly 5 numbered entries (1. through 5.)
      const matches = rendered.match(/^\d+\. \[/gm)
      expect(matches?.length).toBe(5)
    })
  })

  describe('mixed — 2 in conv-A, 4 in conv-B', () => {
    it('lists 2 candidates from conv-A and shows footer with 4 from other conversations', async () => {
      await insertCandidate(baseInput({ conversationId: CONV_A, signalRef: 'a1', summary: 'ConvA first' }))
      await insertCandidate(baseInput({ conversationId: CONV_A, signalRef: 'a2', summary: 'ConvA second' }))
      for (let i = 0; i < 4; i++) {
        await insertCandidate(baseInput({ conversationId: CONV_B, signalRef: `b${i}`, summary: `ConvB ${i}` }))
      }

      const result = await learningCandidatesSideLoadContributor(makeCtx({ conversationId: CONV_A }))
      expect(result.length).toBe(1)

      const rendered = result[0]?.render()
      expect(rendered).toContain('ConvA first')
      expect(rendered).toContain('ConvA second')
      expect(rendered).toContain('4')
      expect(rendered).toContain('other conversations')
    })
  })

  describe('other-only — zero in conv-A, 3 in conv-B', () => {
    it('shows abbreviated footer with M=3 and no candidate list', async () => {
      for (let i = 0; i < 3; i++) {
        await insertCandidate(baseInput({ conversationId: CONV_B, signalRef: `b-only-${i}`, summary: `OnlyB ${i}` }))
      }

      const result = await learningCandidatesSideLoadContributor(makeCtx({ conversationId: CONV_A }))
      expect(result.length).toBe(1)

      const rendered = result[0]?.render()
      // No numbered candidate entries
      const matches = rendered.match(/^\d+\. \[/gm)
      expect(matches).toBeNull()
      // But footer with count
      expect(rendered).toContain('3')
      expect(rendered).toContain('other conversations')
    })
  })

  describe('heartbeat short-circuit', () => {
    it('returns [] for heartbeat synthetic conversationId regardless of pending candidates', async () => {
      await insertCandidate(baseInput({ conversationId: CONV_A }))

      // Heartbeat wakes use synthetic conversationId = 'heartbeat-<scheduleId>'
      const result = await learningCandidatesSideLoadContributor(makeCtx({ conversationId: 'heartbeat-sched-001' }))
      expect(result).toEqual([])
    })
  })

  describe('cross-agent isolation', () => {
    it('returns [] when ctx.agentId differs from inserted candidates agentId', async () => {
      // Insert candidates for MERIGPT_AGENT_ID in CONV_A
      await insertCandidate(baseInput({ conversationId: 'conv-x', signalRef: 'iso-1' }))
      await insertCandidate(baseInput({ conversationId: 'conv-x', signalRef: 'iso-2' }))

      // Run contributor as a different agent
      const result = await learningCandidatesSideLoadContributor(
        makeCtx({ agentId: AGENT_B, conversationId: 'conv-x' }),
      )
      expect(result).toEqual([])
    })
  })
})
