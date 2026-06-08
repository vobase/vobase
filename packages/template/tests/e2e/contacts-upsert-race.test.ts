/**
 * Contacts upsert race E2E — guards the idempotency of
 * `upsertByExternalKey` under concurrent inserts for the same identity.
 *
 * Reproduces the production `contact upsert failed` storm: a retried/redelivered
 * WhatsApp `smb_app_state_sync` burst runs while the first delivery is still in
 * flight, so two upserts for the SAME phone both see an empty `contacts` table,
 * both INSERT, and — before the fix — the loser threw a `uq_contacts_tenant_phone`
 * duplicate-key error. Distinct external keys force both calls past the
 * `findContactByExternalKey` short-circuit and onto the racing insert path.
 *
 * Post-fix: the insert uses `onConflictDoNothing` and re-resolves the winner,
 * so every concurrent caller returns the same contact id and none throw.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { contacts as contactsTable } from '@modules/contacts/schema'
import {
  __resetContactsServiceForTests,
  createContactsService,
  installContactsService,
  upsertByExternalKey,
} from '@modules/contacts/service/contacts'
import { and, eq } from 'drizzle-orm'

import { getSeededOrgId } from '../helpers/seeded-org'
import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../helpers/test-db'

const NOOP_REALTIME = { notify: () => {}, subscribe: () => () => {} }

let dbh: TestDbHandle
let organizationId: string

beforeAll(async () => {
  await resetAndSeedDb()
  dbh = connectTestDb()
  organizationId = await getSeededOrgId(dbh.db)
  __resetContactsServiceForTests()
  installContactsService(createContactsService({ db: dbh.db, realtime: NOOP_REALTIME }))
})

afterAll(async () => {
  __resetContactsServiceForTests()
  await dbh.teardown()
})

describe('upsertByExternalKey concurrency', () => {
  it('collapses concurrent inserts for the same phone onto one contact without throwing', async () => {
    const phone = '+6590000000'
    // Distinct external keys → both calls miss findByExternalKey and race the insert.
    const contacts = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        upsertByExternalKey({
          organizationId,
          channel: 'whatsapp',
          externalKey: `race-key-${i}`,
          phone,
          displayName: 'Test Contact',
        }),
      ),
    )

    const ids = new Set(contacts.map((c) => c.id))
    expect(ids.size).toBe(1)

    const rows = await dbh.db
      .select({ id: contactsTable.id })
      .from(contactsTable)
      .where(and(eq(contactsTable.organizationId, organizationId), eq(contactsTable.phone, phone)))
    expect(rows.length).toBe(1)
  })
})
