/**
 * Integration tests for `contactMemoryChangeMaterializer` (`contacts.contact_memory`).
 *
 * Requires a running Postgres (Docker Compose on :5432). Each `beforeAll` runs
 * `resetAndSeedDb()` for a clean seeded state. The materializer is called
 * directly with a minimal `ChangeProposalRow` and a real Drizzle transaction
 * handle — no service singletons involved.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { ChangeProposalRow } from '@modules/changes/schema'
import { contacts as contactsTable } from '@modules/contacts/schema'
import { SEEDED_CONTACT_ID } from '@modules/contacts/seed'
import { eq } from 'drizzle-orm'

import { getSeededOrgId } from '../../../tests/helpers/seeded-org'
import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../../../tests/helpers/test-db'
import { contactMemoryChangeMaterializer } from './contact-memory-changes'

let dbh: TestDbHandle

let organizationId: string
const CONTACT_ID = SEEDED_CONTACT_ID

function makeProposal(
  overrides: Partial<ChangeProposalRow> & { payload: ChangeProposalRow['payload'] },
): ChangeProposalRow {
  return {
    id: 'tst0prop01',
    organizationId: organizationId,
    resourceModule: 'contacts',
    resourceType: 'contact_memory',
    resourceId: CONTACT_ID,
    status: 'pending',
    confidence: null,
    rationale: null,
    expectedOutcome: null,
    conversationId: null,
    proposedById: 'agent:tst0agent0',
    proposedByKind: 'agent',
    decidedByUserId: null,
    decidedAt: null,
    decidedNote: null,
    appliedHistoryId: null,
    createdAt: new Date(),
    ...overrides,
  }
}

async function readMemory(dbHandle: TestDbHandle, contactId: string): Promise<string | undefined> {
  const rows = (await dbHandle.db
    .select({ memory: contactsTable.memory })
    .from(contactsTable)
    .where(eq(contactsTable.id, contactId))
    .limit(1)) as Array<{ memory: string }>
  return rows[0]?.memory
}

beforeAll(async () => {
  await resetAndSeedDb()
  dbh = connectTestDb()
  organizationId = await getSeededOrgId(dbh.db)
}, 60_000)

afterAll(async () => {
  if (dbh) await dbh.teardown()
})

describe('contactMemoryChangeMaterializer', () => {
  it('markdown_patch append on a contact with empty memory creates the blob', async () => {
    // SEEDED_CONTACT_ID has memory: '' in seed.ts.
    const initialMemory = await readMemory(dbh, CONTACT_ID)
    expect(initialMemory).toBe('')

    const proposal = makeProposal({
      payload: { kind: 'markdown_patch', field: 'memory', mode: 'append', body: '- prefers email over phone' },
    })

    const result = await dbh.db.transaction(async (tx) => contactMemoryChangeMaterializer(proposal, tx as never))

    expect(result.before).toBe('')
    expect(result.after).toBe('- prefers email over phone')
    expect(result.resultId).toBe(CONTACT_ID)

    const stored = await readMemory(dbh, CONTACT_ID)
    expect(stored).toBe('- prefers email over phone')
  })

  it('markdown_patch append on a contact with existing memory concatenates with newline', async () => {
    // Memory already set from the previous test; read it back.
    const existingMemory = await readMemory(dbh, CONTACT_ID)
    expect(existingMemory).toBeTruthy()

    const proposal = makeProposal({
      payload: { kind: 'markdown_patch', field: 'memory', mode: 'append', body: '- follow up on refund' },
    })

    const result = await dbh.db.transaction(async (tx) => contactMemoryChangeMaterializer(proposal, tx as never))

    expect(result.before).toBe(existingMemory)
    expect(result.after).toBe(`${existingMemory}\n- follow up on refund`)

    const stored = await readMemory(dbh, CONTACT_ID)
    expect(stored).toBe(`${existingMemory}\n- follow up on refund`)
  })

  it('markdown_patch append of an already-present line is an idempotent no-op', async () => {
    const existingMemory = await readMemory(dbh, CONTACT_ID)
    expect(existingMemory).toContain('- follow up on refund')

    const proposal = makeProposal({
      payload: { kind: 'markdown_patch', field: 'memory', mode: 'append', body: '- follow up on refund' },
    })

    const result = await dbh.db.transaction(async (tx) => contactMemoryChangeMaterializer(proposal, tx as never))

    expect(result.before).toBe(existingMemory)
    expect(result.after).toBe(existingMemory)

    const stored = await readMemory(dbh, CONTACT_ID)
    expect(stored).toBe(existingMemory)
  })

  it('markdown_patch replace overwrites the blob exactly', async () => {
    const proposal = makeProposal({
      payload: { kind: 'markdown_patch', field: 'memory', mode: 'replace', body: '# Replaced\n\nClean slate.' },
    })

    const result = await dbh.db.transaction(async (tx) => contactMemoryChangeMaterializer(proposal, tx as never))

    expect(result.after).toBe('# Replaced\n\nClean slate.')

    const stored = await readMemory(dbh, CONTACT_ID)
    expect(stored).toBe('# Replaced\n\nClean slate.')
  })

  it('field_set payload throws a validation error', async () => {
    const proposal = makeProposal({
      payload: { kind: 'field_set', fields: { memory: { from: null, to: 'bad' } } },
    })

    await expect(
      dbh.db.transaction(async (tx) => contactMemoryChangeMaterializer(proposal, tx as never)),
    ).rejects.toThrow()
  })
})
