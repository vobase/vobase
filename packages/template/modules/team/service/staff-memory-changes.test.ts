/**
 * Integration tests for `staffMemoryChangeMaterializer` (`team.staff_memory`).
 *
 * Requires a running Postgres (Docker Compose on :5432). Each `beforeAll` runs
 * `resetAndSeedDb()` for a clean seeded state. The materializer is called
 * directly with a minimal `ChangeProposalRow` and a real Drizzle transaction
 * handle — no service singletons involved.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { agentStaffMemory } from '@modules/agents/schema'
import { MERIGPT_AGENT_ID } from '@modules/agents/seed'
import type { ChangeProposalRow } from '@modules/changes/schema'
import { ALICE_USER_ID, MERIDIAN_ORG_ID } from '@modules/contacts/seed'
import { and, eq } from 'drizzle-orm'

import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../../../tests/helpers/test-db'
import { staffMemoryChangeMaterializer } from './staff-memory-changes'

let dbh: TestDbHandle

const ORG_ID = MERIDIAN_ORG_ID
const AGENT_ID = MERIGPT_AGENT_ID
const STAFF_ID = ALICE_USER_ID

function makeProposal(
  overrides: Partial<ChangeProposalRow> & { payload: ChangeProposalRow['payload'] },
): ChangeProposalRow {
  return {
    id: 'tst0prop00',
    organizationId: ORG_ID,
    resourceModule: 'team',
    resourceType: 'staff_memory',
    resourceId: `${AGENT_ID}:${STAFF_ID}`,
    status: 'pending',
    confidence: null,
    rationale: null,
    expectedOutcome: null,
    conversationId: null,
    proposedById: `agent:${AGENT_ID}`,
    proposedByKind: 'agent',
    decidedByUserId: null,
    decidedAt: null,
    decidedNote: null,
    appliedHistoryId: null,
    createdAt: new Date(),
    ...overrides,
  }
}

async function readMemory(dbHandle: TestDbHandle, agentId: string, staffId: string): Promise<string | undefined> {
  const rows = (await dbHandle.db
    .select({ memory: agentStaffMemory.memory })
    .from(agentStaffMemory)
    .where(
      and(
        eq(agentStaffMemory.organizationId, ORG_ID),
        eq(agentStaffMemory.agentId, agentId),
        eq(agentStaffMemory.staffId, staffId),
      ),
    )
    .limit(1)) as Array<{ memory: string }>
  return rows[0]?.memory
}

beforeAll(async () => {
  await resetAndSeedDb()
  dbh = connectTestDb()
}, 60_000)

afterAll(async () => {
  if (dbh) await dbh.teardown()
})

describe('staffMemoryChangeMaterializer', () => {
  it('markdown_patch append on a fresh (agent, staff) creates the row with the body', async () => {
    // Use a staff id not in the seed so we start fresh.
    const freshStaffId = 'usr0fresh01'
    const proposal = makeProposal({
      resourceId: `${AGENT_ID}:${freshStaffId}`,
      payload: { kind: 'markdown_patch', field: 'memory', mode: 'append', body: '- new fact' },
    })

    const result = await dbh.db.transaction(async (tx) => staffMemoryChangeMaterializer(proposal, tx as never))

    expect(result.before).toBe('')
    expect(result.after).toBe('- new fact')
    expect(result.resultId).toBe(`${AGENT_ID}:${freshStaffId}`)

    const stored = await readMemory(dbh, AGENT_ID, freshStaffId)
    expect(stored).toBe('- new fact')
  })

  it('markdown_patch append on an existing row concatenates with newline', async () => {
    // MERIGPT_AGENT_ID + ALICE_USER_ID already has a seeded memory blob.
    const existingMemory = await readMemory(dbh, AGENT_ID, STAFF_ID)
    expect(existingMemory).toBeTruthy()

    const proposal = makeProposal({
      resourceId: `${AGENT_ID}:${STAFF_ID}`,
      payload: { kind: 'markdown_patch', field: 'memory', mode: 'append', body: '- appended fact' },
    })

    const result = await dbh.db.transaction(async (tx) => staffMemoryChangeMaterializer(proposal, tx as never))

    expect(result.before).toBe(existingMemory)
    expect(result.after).toBe(`${existingMemory}\n- appended fact`)

    const stored = await readMemory(dbh, AGENT_ID, STAFF_ID)
    expect(stored).toBe(`${existingMemory}\n- appended fact`)
  })

  it('markdown_patch replace overwrites the blob exactly', async () => {
    const proposal = makeProposal({
      resourceId: `${AGENT_ID}:${STAFF_ID}`,
      payload: { kind: 'markdown_patch', field: 'memory', mode: 'replace', body: '# Replaced\n\nOnly this.' },
    })

    const result = await dbh.db.transaction(async (tx) => staffMemoryChangeMaterializer(proposal, tx as never))

    expect(result.after).toBe('# Replaced\n\nOnly this.')

    const stored = await readMemory(dbh, AGENT_ID, STAFF_ID)
    expect(stored).toBe('# Replaced\n\nOnly this.')
  })

  it('field_set payload throws a validation error', async () => {
    const proposal = makeProposal({
      resourceId: `${AGENT_ID}:${STAFF_ID}`,
      payload: { kind: 'field_set', fields: { memory: { from: null, to: 'bad' } } },
    })

    await expect(
      dbh.db.transaction(async (tx) => staffMemoryChangeMaterializer(proposal, tx as never)),
    ).rejects.toThrow()
  })

  it('malformed resourceId (no colon) throws a validation error', async () => {
    const proposal = makeProposal({
      resourceId: 'no-colon-here',
      payload: { kind: 'markdown_patch', field: 'memory', mode: 'append', body: 'x' },
    })

    await expect(
      dbh.db.transaction(async (tx) => staffMemoryChangeMaterializer(proposal, tx as never)),
    ).rejects.toThrow(/resourceId must be/)
  })
})
