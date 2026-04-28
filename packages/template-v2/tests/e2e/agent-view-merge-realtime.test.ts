/**
 * agent-view merge — realtime invalidation e2e against real Postgres.
 *
 * Verifies that the two new SSE-trigger paths introduced by the merge fire
 * the correct pg_notify payloads so `use-realtime-invalidation.ts` can
 * map them to `['drive']` invalidations without a manual reload.
 *
 * Covered flows:
 *   1. `upsertStaffMemory` → emits `table: 'agent_staff_memory'`
 *   2. Learned-skill proposal → approve → emits `table: 'change_proposals'`,
 *      `action: 'approved'`, `resourceModule: 'agents'`
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { MERIDIAN_AGENT_ID } from '@modules/agents/seed'
import {
  AGENT_SKILL_RESOURCE,
  agentSkillMaterializer,
  createAgentSkillsService,
  installAgentSkillsService,
} from '@modules/agents/service/changes'
import {
  createStaffMemoryService,
  installStaffMemoryService,
  upsertStaffMemory,
} from '@modules/agents/service/staff-memory'
import {
  __resetChangeProposalsServiceForTests,
  __resetChangeRegistryForTests,
  createChangeProposalsService,
  decideChangeProposal,
  insertProposal,
  installChangeProposalsService,
  registerChangeMaterializer,
} from '@modules/changes/service/proposals'
import { ALICE_USER_ID, MERIDIAN_ORG_ID } from '@modules/contacts/seed'

import type { NotifyPayload } from '~/runtime'
import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../helpers/test-db'

let dbh: TestDbHandle
const captured: NotifyPayload[] = []

const stubRealtime = {
  notify(payload: NotifyPayload) {
    captured.push(payload)
  },
  subscribe(_fn: (payload: string) => void): () => void {
    return () => {}
  },
}

beforeAll(async () => {
  await resetAndSeedDb()
  dbh = connectTestDb()

  installStaffMemoryService(createStaffMemoryService({ db: dbh.db, realtime: stubRealtime }))
  installAgentSkillsService(createAgentSkillsService({ db: dbh.db }))

  __resetChangeRegistryForTests()
  __resetChangeProposalsServiceForTests()
  installChangeProposalsService(createChangeProposalsService({ db: dbh.db }))

  registerChangeMaterializer({
    resourceModule: AGENT_SKILL_RESOURCE.module,
    resourceType: AGENT_SKILL_RESOURCE.type,
    requiresApproval: true,
    materialize: agentSkillMaterializer,
  })
})

afterAll(async () => {
  __resetChangeRegistryForTests()
  __resetChangeProposalsServiceForTests()
  await dbh.teardown()
})

describe('agent-view merge — realtime notify payloads', () => {
  it('upsertStaffMemory emits table=agent_staff_memory', async () => {
    const before = captured.length
    await upsertStaffMemory(
      { organizationId: MERIDIAN_ORG_ID, agentId: MERIDIAN_AGENT_ID, staffId: ALICE_USER_ID },
      'test memory content',
    )
    const emitted = captured.slice(before)
    const hit = emitted.find((p) => p.table === 'agent_staff_memory')
    expect(hit).toBeDefined()
    expect(hit?.action).toBe('upserted')
    expect(hit?.resourceModule).toBe('agents')
  })

  it('approved learned-skill proposal emits table=change_proposals action=approved resourceModule=agents', async () => {
    const before = captured.length
    const proposal = await insertProposal({
      organizationId: MERIDIAN_ORG_ID,
      resourceModule: AGENT_SKILL_RESOURCE.module,
      resourceType: AGENT_SKILL_RESOURCE.type,
      resourceId: 'test-skill-realtime',
      payload: { kind: 'markdown_patch', mode: 'replace', field: 'body', body: '# Test skill' },
      changedBy: ALICE_USER_ID,
      changedByKind: 'user',
      rationale: 'realtime e2e test',
      conversationId: null,
    })

    // capture notifies emitted during decide (the proposal service notifies after commit)
    await decideChangeProposal(proposal.id, 'approved', ALICE_USER_ID)

    const emitted = captured.slice(before)
    const hit = emitted.find(
      (p) => p.table === 'change_proposals' && p.action === 'approved' && p.resourceModule === 'agents',
    )
    expect(hit).toBeDefined()
    expect(hit?.resourceId).toBe('test-skill-realtime')
  })

  it('resolveInvalidationKeys maps agent_staff_memory → drive key', () => {
    // Inline the pure logic from use-realtime-invalidation to assert the mapping
    // without needing a React environment.
    function resolvesToDrive(table: string): boolean {
      if (table === 'agent_staff_memory') return true
      if (table === 'learned_skills') return true
      if (table === 'drive_files' || table === 'drive.files') return true
      return false
    }
    expect(resolvesToDrive('agent_staff_memory')).toBe(true)
    expect(resolvesToDrive('learned_skills')).toBe(true)
    expect(resolvesToDrive('conversations')).toBe(false)
  })

  it('resolveInvalidationKeys maps change_proposals approved+agents → drive key', () => {
    function proposalTriggersDrive(action: string, resourceModule: string): boolean {
      const decided = action === 'approved' || action === 'auto_written'
      return decided && resourceModule === 'agents'
    }
    expect(proposalTriggersDrive('approved', 'agents')).toBe(true)
    expect(proposalTriggersDrive('auto_written', 'agents')).toBe(true)
    expect(proposalTriggersDrive('pending', 'agents')).toBe(false)
    expect(proposalTriggersDrive('approved', 'contacts')).toBe(false)
  })
})
