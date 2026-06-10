/**
 * Contact-memory change materializer — `contacts.contact_memory` resource type.
 *
 * Writes the `contacts.contacts.memory` blob for a given contact. The resourceId
 * is the contact id (plain, no prefix).
 *
 * Bypasses the contacts service singleton; reads and writes happen on the
 * proposal/decide transaction handle so the mutation is atomic with the
 * change_history row.
 */

import {
  assertMarkdownPatch,
  type MaterializeResult,
  type Materializer,
  mergeMarkdownPatch,
} from '@modules/changes/service/proposals'
import { conflict } from '@vobase/core'
import { eq } from 'drizzle-orm'

import { contacts as contactsTable } from '../schema'

/** Stable (resourceModule, resourceType) pair shared by registration and the remember tool. */
export const CONTACT_MEMORY_RESOURCE = { module: 'contacts', type: 'contact_memory' } as const

/**
 * Materializer for `contacts.contact_memory` proposals.
 *
 * `proposal.resourceId` is the contact id. Accepts only `markdown_patch`
 * payloads; `field_set` is rejected with a clear validation error.
 */
export const contactMemoryChangeMaterializer: Materializer = async (proposal, tx) => {
  const patch = assertMarkdownPatch(proposal.payload)

  const rows = (await tx
    .select({ memory: contactsTable.memory })
    .from(contactsTable)
    .where(eq(contactsTable.id, proposal.resourceId))
    .limit(1)) as Array<{ memory: string }>

  if (!rows[0]) throw conflict(`contacts/contact_memory: contact not found: ${proposal.resourceId}`)

  const before = rows[0].memory ?? ''
  const after = mergeMarkdownPatch(before, patch)

  await tx.update(contactsTable).set({ memory: after }).where(eq(contactsTable.id, proposal.resourceId))

  return { resultId: proposal.resourceId, before, after } satisfies MaterializeResult
}
