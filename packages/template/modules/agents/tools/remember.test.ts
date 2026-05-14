/**
 * Integration tests for the `remember` agent tool.
 *
 * Requires a running Docker Postgres on :5432 (`docker compose up -d`).
 *
 * Setup mirrors `modules/agents/service/learning-candidates.test.ts` and
 * `tests/e2e/contacts-change-flow.test.ts` — no real LLM, no HTTP transport.
 * The tool's `run` function is exercised via `rememberTool.execute(args, ctx)`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { MERIGPT_AGENT_ID } from '@modules/agents/seed'
import { AGENT_MEMORY_RESOURCE, agentMemoryMaterializer } from '@modules/agents/service/changes'
import {
  __resetLearningCandidatesServiceForTests,
  createLearningCandidatesService,
  insertCandidate,
  installLearningCandidatesService,
} from '@modules/agents/service/learning-candidates'
import { changeProposals } from '@modules/changes/schema'
import {
  __resetChangeProposalsServiceForTests,
  __resetChangeRegistryForTests,
  createChangeProposalsService,
  installChangeProposalsService,
  registerChangeMaterializer,
} from '@modules/changes/service/proposals'
import { SEEDED_CONTACT_ID } from '@modules/contacts/seed'
import {
  CONTACT_MEMORY_RESOURCE,
  contactMemoryChangeMaterializer,
} from '@modules/contacts/service/contact-memory-changes'
import { eq, sql } from 'drizzle-orm'

import { getSeededOrgId } from '~/tests/helpers/seeded-org'
import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '~/tests/helpers/test-db'
import { rememberTool } from './remember'

// ─── Stub realtime ────────────────────────────────────────────────────────────

const stubRealtime = {
  async notify(_payload: unknown) {},
  subscribe(_fn: (payload: string) => void): () => void {
    return () => {}
  },
  async shutdown() {},
}

// ─── Mock ToolContext ─────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<{ conversationId: string }> = {}) {
  return {
    organizationId: organizationId,
    agentId: MERIGPT_AGENT_ID,
    conversationId: overrides.conversationId ?? 'conv-remember-test',
    wakeId: 'wake-remember-test',
    turnIndex: 0,
    toolCallId: 'tool-call-remember-test',
  }
}

// ─── Harness ──────────────────────────────────────────────────────────────────

let dbh: TestDbHandle

let organizationId: string

beforeAll(async () => {
  await resetAndSeedDb()
  dbh = connectTestDb()
  organizationId = await getSeededOrgId(dbh.db)

  __resetChangeRegistryForTests()
  __resetChangeProposalsServiceForTests()

  // Register all materializers needed by the test cases
  registerChangeMaterializer({
    resourceModule: AGENT_MEMORY_RESOURCE.module,
    resourceType: AGENT_MEMORY_RESOURCE.type,
    sensitivity: 'low',
    promptHint: 'agent self-knowledge — auto-write at high confidence',
    materialize: agentMemoryMaterializer,
  })
  registerChangeMaterializer({
    resourceModule: CONTACT_MEMORY_RESOURCE.module,
    resourceType: CONTACT_MEMORY_RESOURCE.type,
    sensitivity: 'low',
    promptHint: 'contact memory prose — auto-write at high confidence',
    materialize: contactMemoryChangeMaterializer,
  })

  installChangeProposalsService(createChangeProposalsService({ db: dbh.db }))
  installLearningCandidatesService(
    createLearningCandidatesService({
      db: dbh.db as unknown as Parameters<typeof createLearningCandidatesService>[0]['db'],
      realtime: stubRealtime,
    }),
  )
}, 60_000)

afterAll(async () => {
  __resetChangeRegistryForTests()
  __resetChangeProposalsServiceForTests()
  __resetLearningCandidatesServiceForTests()
  if (dbh) await dbh.teardown()
})

beforeEach(async () => {
  // Clear per-test state; seed data rows stay
  await dbh.db.execute(sql`TRUNCATE changes.change_proposals CASCADE`)
  await dbh.db.execute(sql`TRUNCATE agents.learning_candidates CASCADE`)
})

// ─── Unknown scope ────────────────────────────────────────────────────────────

describe('unknown scope', () => {
  it('returns ok:false with errorCode=unknown_scope', async () => {
    const result = await rememberTool.execute(
      {
        scope: 'foo.bar',
        body: 'some lesson',
        confidence: 0.9,
        rationale: 'test',
        mode: 'append',
      },
      makeCtx(),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected tool success with inner ok:false')
    const content = result.content as { ok: false; errorCode: string }
    expect(content.ok).toBe(false)
    expect(content.errorCode).toBe('unknown_scope')
  })
})

// ─── agent_memory — high confidence (auto-write) ─────────────────────────────

describe('agents.agent_memory high confidence', () => {
  it('returns status=auto_written and persists the memory patch', async () => {
    const result = await rememberTool.execute(
      {
        scope: 'agents.agent_memory',
        body: '- Always greet the customer by name.',
        confidence: 0.9,
        rationale: 'Derived from positive feedback pattern',
        mode: 'append',
      },
      makeCtx(),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')

    const content = result.content as { ok: true; status: string; proposalId: string }
    expect(content.status).toBe('auto_written')
    expect(content.proposalId).toBeTruthy()

    // Verify the agent's working_memory was actually patched
    const rows = await dbh.db.execute(
      sql`SELECT working_memory FROM agents.agent_definitions WHERE id = ${MERIGPT_AGENT_ID}`,
    )
    expect(rows.length).toBe(1)
    expect(rows[0]?.working_memory).toContain('Always greet the customer by name.')
  })
})

// ─── agent_memory — low confidence (pending) ─────────────────────────────────

describe('agents.agent_memory low confidence', () => {
  it('returns status=pending and inserts a pending change_proposals row', async () => {
    const result = await rememberTool.execute(
      {
        scope: 'agents.agent_memory',
        body: '- Possibly reduce follow-up frequency.',
        confidence: 0.5,
        rationale: 'Uncertain inference',
        mode: 'append',
      },
      makeCtx(),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')

    const content = result.content as { ok: true; status: string; proposalId: string }
    expect(content.status).toBe('pending')
    expect(content.proposalId).toBeTruthy()

    // Verify a pending row exists in change_proposals
    const rows = await dbh.db.select().from(changeProposals).where(eq(changeProposals.id, content.proposalId))
    expect(rows.length).toBe(1)
    expect(rows[0]?.status).toBe('pending')
  })
})

// ─── agent_memory — very low confidence (dropped) ────────────────────────────

describe('agents.agent_memory trivial confidence', () => {
  it('returns ok:false with errorCode=trivial_proposal when confidence is too low', async () => {
    const result = await rememberTool.execute(
      {
        scope: 'agents.agent_memory',
        body: '- Some vague guess.',
        confidence: 0.1,
        rationale: 'Not sure at all',
        mode: 'append',
      },
      makeCtx(),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected tool success with inner ok:false')

    const content = result.content as { ok: false; errorCode: string }
    expect(content.ok).toBe(false)
    expect(content.errorCode).toBe('trivial_proposal')
  })
})

// ─── contact_memory — high confidence (auto-write) ───────────────────────────

describe('contacts.contact_memory high confidence', () => {
  it('returns status=auto_written for contact memory scope', async () => {
    const result = await rememberTool.execute(
      {
        scope: 'contacts.contact_memory',
        resourceId: SEEDED_CONTACT_ID,
        body: '- Prefers async communication.',
        confidence: 0.85,
        rationale: 'Customer stated preference',
        mode: 'append',
      },
      makeCtx(),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')

    const content = result.content as { ok: true; status: string; proposalId: string }
    expect(content.status).toBe('auto_written')
    expect(content.proposalId).toBeTruthy()
  })
})

// ─── staff_memory — missing resourceId ───────────────────────────────────────

describe('team.staff_memory missing resourceId', () => {
  it('returns ok:false with errorCode=missing_resource_id when resourceId omitted', async () => {
    // Register a stub staff_memory materializer so the scope is known
    __resetChangeRegistryForTests()
    registerChangeMaterializer({
      resourceModule: AGENT_MEMORY_RESOURCE.module,
      resourceType: AGENT_MEMORY_RESOURCE.type,
      sensitivity: 'low',
      promptHint: 'agent self-knowledge',
      materialize: agentMemoryMaterializer,
    })
    registerChangeMaterializer({
      resourceModule: CONTACT_MEMORY_RESOURCE.module,
      resourceType: CONTACT_MEMORY_RESOURCE.type,
      sensitivity: 'low',
      promptHint: 'contact memory prose',
      materialize: contactMemoryChangeMaterializer,
    })
    registerChangeMaterializer({
      resourceModule: 'team',
      resourceType: 'staff_memory',
      sensitivity: 'low',
      promptHint: 'per-(agent,staff) working preferences',
      materialize: async (proposal, _tx) => ({ resultId: proposal.resourceId, before: null, after: null }),
    })

    const result = await rememberTool.execute(
      {
        scope: 'team.staff_memory',
        // no resourceId — should fail
        body: '- Alice handles refunds via card.',
        confidence: 0.8,
        rationale: 'Observed preference',
        mode: 'append',
      },
      makeCtx(),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected tool success with inner ok:false')

    const content = result.content as { ok: false; errorCode: string }
    expect(content.ok).toBe(false)
    expect(content.errorCode).toBe('missing_resource_id')

    // Restore for subsequent tests
    __resetChangeRegistryForTests()
    registerChangeMaterializer({
      resourceModule: AGENT_MEMORY_RESOURCE.module,
      resourceType: AGENT_MEMORY_RESOURCE.type,
      sensitivity: 'low',
      promptHint: 'agent self-knowledge — auto-write at high confidence',
      materialize: agentMemoryMaterializer,
    })
    registerChangeMaterializer({
      resourceModule: CONTACT_MEMORY_RESOURCE.module,
      resourceType: CONTACT_MEMORY_RESOURCE.type,
      sensitivity: 'low',
      promptHint: 'contact memory prose — auto-write at high confidence',
      materialize: contactMemoryChangeMaterializer,
    })
  })
})

// ─── candidateId consumption ──────────────────────────────────────────────────

describe('candidateId consumption', () => {
  it('marks the learning_candidate row as consumed when candidateId is supplied', async () => {
    const candidate = await insertCandidate({
      organizationId: organizationId,
      agentId: MERIGPT_AGENT_ID,
      conversationId: 'conv-remember-candidate',
      signalKind: 'coaching_note',
      signalRef: 'msg-ref-remember-001',
      triageConfidence: 0.8,
      summary: 'Always ask about budget upfront.',
      context: 'Staff coaching note context.',
    })

    const result = await rememberTool.execute(
      {
        candidateId: candidate.id,
        scope: 'agents.agent_memory',
        body: '- Always ask about budget upfront.',
        confidence: 0.9,
        rationale: 'Staff coaching note',
        mode: 'append',
      },
      makeCtx(),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    const content = result.content as { ok: true; status: string; proposalId: string }
    expect(content.status).toBe('auto_written')

    // Verify candidate flipped to consumed with matching proposalId
    const rows = await dbh.db.execute(
      sql`SELECT status, consumed_by_proposal_id FROM agents.learning_candidates WHERE id = ${candidate.id}`,
    )
    expect(rows.length).toBe(1)
    expect(rows[0]?.status).toBe('consumed')
    expect(rows[0]?.consumed_by_proposal_id).toBe(content.proposalId)
  })
})
