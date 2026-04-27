/**
 * Contacts change-flow E2E — exercises the full propose→materialize→audit
 * lifecycle for the `(contacts, contact)` resource against a real Postgres.
 *
 * Two paths are covered:
 *   1. Auto-write (the production registration via `requiresApproval: false`):
 *      `insertProposal` synchronously runs the materializer in-tx, writes the
 *      contact row, and emits a `change_history` entry with `appliedProposalId`
 *      linked back to the proposal.
 *   2. Approval-gated (a test-only re-registration with `requiresApproval: true`
 *      under a distinct resourceType): `insertProposal` writes a `pending` row
 *      that the inbox returns; `decideChangeProposal('approved', ...)` then
 *      runs the same materializer, writes history, and updates the proposal
 *      with `appliedHistoryId` pointing at the new history row.
 *
 * The test interacts with the service through the installed singleton
 * (same path the CLI verb body uses), so it covers the CLI invocation contract
 * without spinning up the HTTP transport.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { changeHistory, changeProposals } from '@modules/changes/schema'
import {
  __resetChangeProposalsServiceForTests,
  __resetChangeRegistryForTests,
  createChangeProposalsService,
  decideChangeProposal,
  insertProposal,
  installChangeProposalsService,
  listInbox,
  registerChangeMaterializer,
} from '@modules/changes/service/proposals'
import { contacts as contactsTable } from '@modules/contacts/schema'
import { MERIDIAN_ORG_ID, SEEDED_CONTACT_ID } from '@modules/contacts/seed'
import { contactChangeMaterializer } from '@modules/contacts/service/changes'
import { and, eq } from 'drizzle-orm'

import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../helpers/test-db'

let dbh: TestDbHandle

beforeAll(async () => {
  await resetAndSeedDb()
  dbh = connectTestDb()

  __resetChangeRegistryForTests()
  __resetChangeProposalsServiceForTests()

  registerChangeMaterializer({
    resourceModule: 'contacts',
    resourceType: 'contact',
    requiresApproval: false,
    materialize: contactChangeMaterializer,
  })
  // Test-only sibling registration that exercises the approval-gated path
  // without diverging from the production materializer behavior.
  registerChangeMaterializer({
    resourceModule: 'contacts',
    resourceType: 'contact_pending',
    requiresApproval: true,
    materialize: contactChangeMaterializer,
  })

  installChangeProposalsService(createChangeProposalsService({ db: dbh.db }))
}, 60_000)

afterAll(async () => {
  __resetChangeRegistryForTests()
  __resetChangeProposalsServiceForTests()
  if (dbh) await dbh.teardown()
})

describe('contacts change-flow (auto-write path: requiresApproval=false)', () => {
  it('insertProposal materializes inline, writes history, links the records', async () => {
    const result = await insertProposal({
      organizationId: MERIDIAN_ORG_ID,
      resourceModule: 'contacts',
      resourceType: 'contact',
      resourceId: SEEDED_CONTACT_ID,
      payload: {
        kind: 'field_set',
        fields: { displayName: { from: 'Test Customer', to: 'Test Customer (auto-written)' } },
      },
      changedBy: 'tst0agent00',
      changedByKind: 'agent',
      rationale: 'auto-write smoke',
    })

    expect(result.status).toBe('auto_written')

    const proposalRows = await dbh.db.select().from(changeProposals).where(eq(changeProposals.id, result.id))
    expect(proposalRows.length).toBe(1)
    const proposal = proposalRows[0]
    expect(proposal.status).toBe('auto_written')
    expect(proposal.appliedHistoryId).toBeTruthy()

    const historyRows = await dbh.db
      .select()
      .from(changeHistory)
      .where(eq(changeHistory.id, proposal.appliedHistoryId as string))
    expect(historyRows.length).toBe(1)
    expect(historyRows[0].appliedProposalId).toBe(result.id)

    const contactRows = await dbh.db
      .select({ displayName: contactsTable.displayName })
      .from(contactsTable)
      .where(eq(contactsTable.id, SEEDED_CONTACT_ID))
    expect(contactRows[0].displayName).toBe('Test Customer (auto-written)')
  })
})

describe('contacts change-flow (approval-gated path: requiresApproval=true)', () => {
  it('insertProposal → inbox → decide("approved") → linked history row', async () => {
    const proposed = await insertProposal({
      organizationId: MERIDIAN_ORG_ID,
      resourceModule: 'contacts',
      resourceType: 'contact_pending',
      resourceId: SEEDED_CONTACT_ID,
      payload: {
        kind: 'markdown_patch',
        mode: 'append',
        field: 'notes',
        body: 'NOTE: review on next interaction.',
      },
      changedBy: 'tst0agent00',
      changedByKind: 'agent',
      rationale: 'approval-gated smoke',
    })
    expect(proposed.status).toBe('pending')

    const inbox = await listInbox(MERIDIAN_ORG_ID)
    expect(inbox.some((r) => r.id === proposed.id)).toBe(true)

    const decision = await decideChangeProposal(proposed.id, 'approved', 'usr0alice0', 'looks good')
    expect(decision.status).toBe('approved')
    expect(decision.appliedHistoryId).toBeTruthy()

    const proposalRows = await dbh.db.select().from(changeProposals).where(eq(changeProposals.id, proposed.id))
    expect(proposalRows[0].status).toBe('approved')
    expect(proposalRows[0].decidedByUserId).toBe('usr0alice0')
    expect(proposalRows[0].appliedHistoryId).toBe(decision.appliedHistoryId)

    const historyRows = await dbh.db
      .select()
      .from(changeHistory)
      .where(
        and(
          eq(changeHistory.id, decision.appliedHistoryId as string),
          eq(changeHistory.appliedProposalId, proposed.id),
        ),
      )
    expect(historyRows.length).toBe(1)

    const contactRows = await dbh.db
      .select({ notes: contactsTable.notes })
      .from(contactsTable)
      .where(eq(contactsTable.id, SEEDED_CONTACT_ID))
    expect(contactRows[0].notes).toContain('NOTE: review on next interaction.')
  })

  it('decide("rejected") writes rejection without touching history or contact', async () => {
    const proposed = await insertProposal({
      organizationId: MERIDIAN_ORG_ID,
      resourceModule: 'contacts',
      resourceType: 'contact_pending',
      resourceId: SEEDED_CONTACT_ID,
      payload: {
        kind: 'field_set',
        fields: { email: { from: null, to: 'rejected@nowhere.test' } },
      },
      changedBy: 'tst0agent00',
      changedByKind: 'agent',
    })

    const before = await dbh.db
      .select({ email: contactsTable.email })
      .from(contactsTable)
      .where(eq(contactsTable.id, SEEDED_CONTACT_ID))

    const decision = await decideChangeProposal(proposed.id, 'rejected', 'usr0alice0', 'bad data')
    expect(decision.status).toBe('rejected')
    expect(decision.appliedHistoryId).toBeNull()

    const after = await dbh.db
      .select({ email: contactsTable.email })
      .from(contactsTable)
      .where(eq(contactsTable.id, SEEDED_CONTACT_ID))
    expect(after[0].email).toBe(before[0].email)

    const proposalRows = await dbh.db.select().from(changeProposals).where(eq(changeProposals.id, proposed.id))
    expect(proposalRows[0].status).toBe('rejected')
    expect(proposalRows[0].decidedNote).toBe('bad data')
    expect(proposalRows[0].appliedHistoryId).toBeNull()
  })
})
