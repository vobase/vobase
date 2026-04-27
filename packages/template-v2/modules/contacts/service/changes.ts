/**
 * Materializer bypasses the contacts service singleton because writes must
 * happen on the proposal/decide transaction handle, not the bound singleton db.
 */

import type { MaterializeResult, Materializer, TxLike } from '@modules/changes/service/proposals'
import type { ChangePayload } from '@vobase/core'
import { conflict, validation } from '@vobase/core'
import { eq } from 'drizzle-orm'

import type { Contact } from '../schema'
import { contacts as contactsTable } from '../schema'

/** Stable (resourceModule, resourceType) pair shared by registration, CLI verb, and CRUD audit calls. */
export const CONTACT_RESOURCE = { module: 'contacts', type: 'contact' } as const

const MARKDOWN_FIELDS = new Set<keyof Contact>(['notes', 'profile'])
const SCALAR_FIELDS = new Set<keyof Contact>(['displayName', 'email', 'phone', 'segments', 'marketingOptOut'])

export const contactChangeMaterializer: Materializer = async (proposal, tx) => {
  const before = await loadContact(tx, proposal.resourceId)
  const after = applyPayload(before, proposal.payload)
  await writeContact(tx, proposal.resourceId, after)
  return {
    resultId: proposal.resourceId,
    before,
    after,
  } satisfies MaterializeResult
}

async function loadContact(tx: TxLike, id: string): Promise<Contact> {
  const rows = (await tx.select().from(contactsTable).where(eq(contactsTable.id, id)).limit(1)) as unknown as Contact[]
  const row = rows[0]
  if (!row) throw conflict(`contacts/changes: contact not found: ${id}`)
  return row
}

async function writeContact(tx: TxLike, id: string, next: Contact): Promise<void> {
  const set: Record<string, unknown> = {
    displayName: next.displayName,
    email: next.email,
    phone: next.phone,
    profile: next.profile,
    notes: next.notes,
    attributes: next.attributes,
    segments: next.segments,
    marketingOptOut: next.marketingOptOut,
    marketingOptOutAt: next.marketingOptOutAt,
  }
  await tx.update(contactsTable).set(set).where(eq(contactsTable.id, id))
}

function applyPayload(before: Contact, payload: ChangePayload): Contact {
  if (payload.kind === 'markdown_patch') return applyMarkdownPatch(before, payload)
  if (payload.kind === 'field_set') return applyFieldSet(before, payload)
  throw validation(
    { kind: payload.kind },
    `contacts/changes: json_patch payload not supported for resourceType=contact`,
  )
}

function applyMarkdownPatch(before: Contact, payload: Extract<ChangePayload, { kind: 'markdown_patch' }>): Contact {
  if (!MARKDOWN_FIELDS.has(payload.field as keyof Contact)) {
    throw validation(
      { field: payload.field },
      `contacts/changes: markdown_patch field must be 'notes' or 'profile' (got '${payload.field}')`,
    )
  }
  const field = payload.field as 'notes' | 'profile'
  const current = before[field]
  const next = payload.mode === 'append' ? (current ? `${current}\n${payload.body}` : payload.body) : payload.body
  return { ...before, [field]: next }
}

function applyFieldSet(before: Contact, payload: Extract<ChangePayload, { kind: 'field_set' }>): Contact {
  const next: Contact = {
    ...before,
    attributes: { ...before.attributes },
  }
  for (const [key, change] of Object.entries(payload.fields)) {
    if (key.startsWith('attributes.')) {
      const attrKey = key.slice('attributes.'.length)
      if (!attrKey) {
        throw validation({ key }, `contacts/changes: field_set 'attributes.' requires a key after the dot`)
      }
      next.attributes[attrKey] = change.to as Contact['attributes'][string]
      continue
    }
    if (!SCALAR_FIELDS.has(key as keyof Contact)) {
      throw validation(
        { key },
        `contacts/changes: field_set unsupported field '${key}' (allowed: ${[...SCALAR_FIELDS].join(', ')}, attributes.*)`,
      )
    }
    if (key === 'marketingOptOut') {
      next.marketingOptOut = Boolean(change.to)
      next.marketingOptOutAt = next.marketingOptOut ? new Date() : null
      continue
    }
    if (key === 'segments') {
      next.segments = Array.isArray(change.to) ? (change.to as string[]) : []
      continue
    }
    // Remaining scalars: displayName / email / phone — strings or null.
    const value = change.to
    if (value !== null && typeof value !== 'string') {
      throw validation({ key, type: typeof value }, `contacts/changes: field_set '${key}' must be a string or null`)
    }
    ;(next as unknown as Record<string, unknown>)[key] = value
  }
  return next
}
