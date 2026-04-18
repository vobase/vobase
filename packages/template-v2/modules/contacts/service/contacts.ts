/**
 * REAL Phase 1 — get, upsertByExternal, resolveStaffByExternal.
 * All other methods throw not-implemented-in-phase-1.
 */

import type { UpsertByExternalInput } from '@server/contracts/contacts-port'
import type { Contact, StaffBinding } from '@server/contracts/domain-types'

let _db: unknown = null

export function setDb(db: unknown): void {
  _db = db
}

function requireDb(): unknown {
  if (!_db) throw new Error('contacts/contacts: db not initialised — call setDb() in module init')
  return _db
}

export async function get(id: string): Promise<Contact> {
  const { contacts } = await import('@modules/contacts/schema')
  const { eq } = await import('drizzle-orm')
  const db = requireDb() as { select: Function }
  const rows = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1)
  const row = rows[0]
  if (!row) throw new Error(`contact not found: ${id}`)
  return row as Contact
}

export async function getByPhone(tenantId: string, phone: string): Promise<Contact | null> {
  const { contacts } = await import('@modules/contacts/schema')
  const { eq, and } = await import('drizzle-orm')
  const db = requireDb() as { select: Function }
  const rows = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.tenantId, tenantId), eq(contacts.phone, phone)))
    .limit(1)
  return (rows[0] as Contact) ?? null
}

export async function getByEmail(tenantId: string, email: string): Promise<Contact | null> {
  const { contacts } = await import('@modules/contacts/schema')
  const { eq, and } = await import('drizzle-orm')
  const db = requireDb() as { select: Function }
  const rows = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.tenantId, tenantId), eq(contacts.email, email)))
    .limit(1)
  return (rows[0] as Contact) ?? null
}

export async function upsertByExternal(input: UpsertByExternalInput): Promise<Contact> {
  const { contacts } = await import('@modules/contacts/schema')
  const { eq, and, or } = await import('drizzle-orm')
  const db = requireDb() as { select: Function; insert: Function }

  // Try to find existing by phone or email
  const conditions = []
  if (input.phone) conditions.push(eq(contacts.phone, input.phone))
  if (input.email) conditions.push(eq(contacts.email, input.email))

  if (conditions.length > 0) {
    const existing = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.tenantId, input.tenantId), or(...conditions)))
      .limit(1)

    if (existing[0]) return existing[0] as Contact
  }

  // Insert new contact
  const rows = await (db as { insert: Function })
    .insert(contacts)
    .values({
      tenantId: input.tenantId,
      phone: input.phone ?? null,
      email: input.email ?? null,
      displayName: input.displayName ?? null,
    })
    .returning()

  const row = rows[0]
  if (!row) throw new Error('contacts/upsertByExternal: insert returned no rows')
  return row as Contact
}

export async function resolveStaffByExternal(
  channelInstanceId: string,
  externalIdentifier: string,
): Promise<StaffBinding | null> {
  const { staffChannelBindings } = await import('@modules/contacts/schema')
  const { eq, and } = await import('drizzle-orm')
  const db = requireDb() as { select: Function }
  const rows = await db
    .select()
    .from(staffChannelBindings)
    .where(
      and(
        eq(staffChannelBindings.channelInstanceId, channelInstanceId),
        eq(staffChannelBindings.externalIdentifier, externalIdentifier),
      ),
    )
    .limit(1)
  return (rows[0] as StaffBinding) ?? null
}

export async function readWorkingMemory(id: string): Promise<string> {
  const { contacts } = await import('@modules/contacts/schema')
  const { eq } = await import('drizzle-orm')
  const db = requireDb() as { select: Function }
  const rows = await db
    .select({ workingMemory: contacts.workingMemory })
    .from(contacts)
    .where(eq(contacts.id, id))
    .limit(1)
  const row = rows[0]
  if (!row) throw new Error(`contact not found: ${id}`)
  return (row as { workingMemory: string }).workingMemory
}

export async function upsertWorkingMemorySection(id: string, heading: string, body: string): Promise<void> {
  const current = await readWorkingMemory(id)
  const updated = setSection(current, heading, body)
  await _writeWorkingMemory(id, updated)
}

export async function appendWorkingMemory(id: string, line: string): Promise<void> {
  const current = await readWorkingMemory(id)
  const updated = current ? `${current}\n${line}` : line
  await _writeWorkingMemory(id, updated)
}

export async function removeWorkingMemorySection(id: string, heading: string): Promise<void> {
  const current = await readWorkingMemory(id)
  const updated = removeSection(current, heading)
  await _writeWorkingMemory(id, updated)
}

async function _writeWorkingMemory(id: string, value: string): Promise<void> {
  const { contacts } = await import('@modules/contacts/schema')
  const { eq } = await import('drizzle-orm')
  const db = requireDb() as { update: Function }
  await db.update(contacts).set({ workingMemory: value }).where(eq(contacts.id, id))
}

/** Upsert a `##` section in raw markdown — preserves all other sections. */
function setSection(md: string, heading: string, body: string): string {
  const lines = md.split('\n')
  const result: string[] = []
  let inTarget = false
  let found = false

  for (const line of lines) {
    const m = line.match(/^##\s+(.+)/)
    if (m) {
      if (inTarget) inTarget = false
      if (m[1].trim() === heading) {
        found = true
        inTarget = true
        result.push(`## ${heading}`)
        result.push('')
        result.push(body)
        result.push('')
        continue
      }
    }
    if (inTarget) continue
    result.push(line)
  }

  if (!found) {
    if (result.length > 0 && result[result.length - 1] !== '') result.push('')
    result.push(`## ${heading}`)
    result.push('')
    result.push(body)
    result.push('')
  }

  return result
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
}

/** Remove a `##` section and its body from raw markdown. */
function removeSection(md: string, heading: string): string {
  const lines = md.split('\n')
  const result: string[] = []
  let skip = false

  for (const line of lines) {
    const m = line.match(/^##\s+(.+)/)
    if (m) {
      skip = m[1].trim() === heading
    }
    if (!skip) result.push(line)
  }

  return result
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
}

export async function setSegments(_id: string, _segments: string[]): Promise<void> {
  throw new Error('not-implemented-in-phase-1: contacts/setSegments')
}

export async function setMarketingOptOut(_id: string, _value: boolean): Promise<void> {
  throw new Error('not-implemented-in-phase-1: contacts/setMarketingOptOut')
}

export async function bindStaff(
  _userId: string,
  _channelInstanceId: string,
  _externalIdentifier: string,
): Promise<StaffBinding> {
  throw new Error('not-implemented-in-phase-1: contacts/bindStaff')
}

export async function remove(_id: string): Promise<void> {
  throw new Error('not-implemented-in-phase-1: contacts/remove')
}
