/**
 * REAL Phase 1 — get, upsertByExternal, resolveStaffByExternal.
 * All other methods throw not-implemented-in-phase-1.
 */

import { contacts, staffChannelBindings } from '@modules/contacts/schema'
import { and, eq, or } from 'drizzle-orm'

import type { Contact, StaffBinding } from '../schema'

export interface UpsertByExternalInput {
  organizationId: string
  phone?: string
  email?: string
  displayName?: string
}

export interface CreateContactInput {
  organizationId: string
  displayName?: string | null
  email?: string | null
  phone?: string | null
  segments?: string[]
  marketingOptOut?: boolean
}

export interface UpdateContactInput {
  displayName?: string | null
  email?: string | null
  phone?: string | null
  segments?: string[]
  marketingOptOut?: boolean
}

interface ContactsDeps {
  db: unknown
}

export interface ContactsService {
  get(id: string): Promise<Contact>
  list(organizationId: string): Promise<Contact[]>
  getByPhone(organizationId: string, phone: string): Promise<Contact | null>
  getByEmail(organizationId: string, email: string): Promise<Contact | null>
  create(input: CreateContactInput): Promise<Contact>
  update(id: string, patch: UpdateContactInput): Promise<Contact>
  upsertByExternal(input: UpsertByExternalInput): Promise<Contact>
  resolveStaffByExternal(channelInstanceId: string, externalIdentifier: string): Promise<StaffBinding | null>
  readNotes(id: string): Promise<string>
  upsertNotesSection(id: string, heading: string, body: string): Promise<void>
  appendNotes(id: string, line: string): Promise<void>
  removeNotesSection(id: string, heading: string): Promise<void>
  setSegments(id: string, segments: string[]): Promise<void>
  setMarketingOptOut(id: string, value: boolean): Promise<void>
  bindStaff(userId: string, channelInstanceId: string, externalIdentifier: string): Promise<StaffBinding>
  remove(id: string): Promise<void>
}

export function createContactsService(deps: ContactsDeps): ContactsService {
  const db = deps.db as { select: Function; insert: Function; update: Function }

  async function get(id: string): Promise<Contact> {
    const rows = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1)
    const row = rows[0]
    if (!row) throw new Error(`contact not found: ${id}`)
    return row as Contact
  }

  async function list(organizationId: string): Promise<Contact[]> {
    const rows = (await db.select().from(contacts).where(eq(contacts.organizationId, organizationId))) as unknown[]
    return rows as Contact[]
  }

  async function getByPhone(organizationId: string, phone: string): Promise<Contact | null> {
    const rows = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.organizationId, organizationId), eq(contacts.phone, phone)))
      .limit(1)
    return (rows[0] as Contact) ?? null
  }

  async function getByEmail(organizationId: string, email: string): Promise<Contact | null> {
    const rows = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.organizationId, organizationId), eq(contacts.email, email)))
      .limit(1)
    return (rows[0] as Contact) ?? null
  }

  async function upsertByExternal(input: UpsertByExternalInput): Promise<Contact> {
    const conditions = []
    if (input.phone) conditions.push(eq(contacts.phone, input.phone))
    if (input.email) conditions.push(eq(contacts.email, input.email))

    if (conditions.length > 0) {
      const existing = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.organizationId, input.organizationId), or(...conditions)))
        .limit(1)

      if (existing[0]) return existing[0] as Contact
    }

    const rows = await db
      .insert(contacts)
      .values({
        organizationId: input.organizationId,
        phone: input.phone ?? null,
        email: input.email ?? null,
        displayName: input.displayName ?? null,
      })
      .returning()

    const row = rows[0]
    if (!row) throw new Error('contacts/upsertByExternal: insert returned no rows')
    return row as Contact
  }

  async function resolveStaffByExternal(
    channelInstanceId: string,
    externalIdentifier: string,
  ): Promise<StaffBinding | null> {
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

  async function readNotes(id: string): Promise<string> {
    const rows = await db.select({ notes: contacts.notes }).from(contacts).where(eq(contacts.id, id)).limit(1)
    const row = rows[0]
    if (!row) throw new Error(`contact not found: ${id}`)
    return (row as { notes: string }).notes
  }

  async function writeNotes(id: string, value: string): Promise<void> {
    await db.update(contacts).set({ notes: value }).where(eq(contacts.id, id))
  }

  async function upsertNotesSection(id: string, heading: string, body: string): Promise<void> {
    const current = await readNotes(id)
    const updated = setSection(current, heading, body)
    await writeNotes(id, updated)
  }

  async function appendNotes(id: string, line: string): Promise<void> {
    const current = await readNotes(id)
    const updated = current ? `${current}\n${line}` : line
    await writeNotes(id, updated)
  }

  async function removeNotesSection(id: string, heading: string): Promise<void> {
    const current = await readNotes(id)
    const updated = removeSection(current, heading)
    await writeNotes(id, updated)
  }

  async function create(input: CreateContactInput): Promise<Contact> {
    const rows = (await db
      .insert(contacts)
      .values({
        organizationId: input.organizationId,
        displayName: input.displayName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        segments: input.segments ?? [],
        marketingOptOut: input.marketingOptOut ?? false,
        marketingOptOutAt: input.marketingOptOut ? new Date() : null,
      })
      .returning()) as unknown[]
    const row = rows[0]
    if (!row) throw new Error('contacts/create: insert returned no rows')
    return row as Contact
  }

  async function update(id: string, patch: UpdateContactInput): Promise<Contact> {
    const set: Record<string, unknown> = {}
    if (patch.displayName !== undefined) set.displayName = patch.displayName
    if (patch.email !== undefined) set.email = patch.email
    if (patch.phone !== undefined) set.phone = patch.phone
    if (patch.segments !== undefined) set.segments = patch.segments
    if (patch.marketingOptOut !== undefined) {
      set.marketingOptOut = patch.marketingOptOut
      set.marketingOptOutAt = patch.marketingOptOut ? new Date() : null
    }
    const rows = (await db.update(contacts).set(set).where(eq(contacts.id, id)).returning()) as unknown[]
    const row = rows[0]
    if (!row) throw new Error(`contact not found: ${id}`)
    return row as Contact
  }

  async function setSegments(id: string, segments: string[]): Promise<void> {
    await update(id, { segments })
  }

  async function setMarketingOptOut(id: string, value: boolean): Promise<void> {
    await update(id, { marketingOptOut: value })
  }

  // biome-ignore lint/suspicious/useAwait: contract requires async signature
  async function bindStaff(
    _userId: string,
    _channelInstanceId: string,
    _externalIdentifier: string,
  ): Promise<StaffBinding> {
    throw new Error('not-implemented-in-phase-1: contacts/bindStaff')
  }

  // biome-ignore lint/suspicious/useAwait: contract requires async signature
  async function remove(_id: string): Promise<void> {
    throw new Error('not-implemented-in-phase-1: contacts/remove')
  }

  return {
    get,
    list,
    getByPhone,
    getByEmail,
    create,
    update,
    upsertByExternal,
    resolveStaffByExternal,
    readNotes,
    upsertNotesSection,
    appendNotes,
    removeNotesSection,
    setSegments,
    setMarketingOptOut,
    bindStaff,
    remove,
  }
}

let _currentContactsService: ContactsService | null = null

export function installContactsService(svc: ContactsService): void {
  _currentContactsService = svc
}

export function __resetContactsServiceForTests(): void {
  _currentContactsService = null
}

function current(): ContactsService {
  if (!_currentContactsService) {
    throw new Error('contacts/contacts: service not installed — call installContactsService() in module init')
  }
  return _currentContactsService
}

export function get(id: string): Promise<Contact> {
  return current().get(id)
}
export function list(organizationId: string): Promise<Contact[]> {
  return current().list(organizationId)
}
export function getByPhone(organizationId: string, phone: string): Promise<Contact | null> {
  return current().getByPhone(organizationId, phone)
}
export function getByEmail(organizationId: string, email: string): Promise<Contact | null> {
  return current().getByEmail(organizationId, email)
}
export function create(input: CreateContactInput): Promise<Contact> {
  return current().create(input)
}
export function update(id: string, patch: UpdateContactInput): Promise<Contact> {
  return current().update(id, patch)
}
export function upsertByExternal(input: UpsertByExternalInput): Promise<Contact> {
  return current().upsertByExternal(input)
}
export function resolveStaffByExternal(
  channelInstanceId: string,
  externalIdentifier: string,
): Promise<StaffBinding | null> {
  return current().resolveStaffByExternal(channelInstanceId, externalIdentifier)
}
export function readNotes(id: string): Promise<string> {
  return current().readNotes(id)
}
export function upsertNotesSection(id: string, heading: string, body: string): Promise<void> {
  return current().upsertNotesSection(id, heading, body)
}
export function appendNotes(id: string, line: string): Promise<void> {
  return current().appendNotes(id, line)
}
export function removeNotesSection(id: string, heading: string): Promise<void> {
  return current().removeNotesSection(id, heading)
}
export function setSegments(id: string, segments: string[]): Promise<void> {
  return current().setSegments(id, segments)
}
export function setMarketingOptOut(id: string, value: boolean): Promise<void> {
  return current().setMarketingOptOut(id, value)
}
export function bindStaff(
  userId: string,
  channelInstanceId: string,
  externalIdentifier: string,
): Promise<StaffBinding> {
  return current().bindStaff(userId, channelInstanceId, externalIdentifier)
}
export function remove(id: string): Promise<void> {
  return current().remove(id)
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
