/**
 * REAL Phase 1 — get, upsertByExternalKey, resolveStaffByExternal.
 * All other methods throw not-implemented-in-phase-1.
 */

import { contactExternalKeys, contacts, staffChannelBindings } from '@modules/contacts/schema'
import { and, eq } from 'drizzle-orm'

import { type RealtimeService, safeNotify } from '~/runtime'
import type { Contact, StaffBinding } from '../schema'

export interface UpsertByExternalKeyInput {
  organizationId: string
  /** Channel name as registered in `channels/service/registry.ts` (e.g. `whatsapp`, `web`). */
  channel: string
  /** Bare per-channel inbound dedup key (E.164 phone for WA, session id for web). */
  externalKey: string
  /** E.164 phone (with leading `+`) when the channel carries a phone identity. */
  phone?: string | null
  /** Lowercased RFC email when the channel carries an email identity. */
  email?: string | null
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
  realtime: RealtimeService
}

export interface ContactsService {
  get(id: string): Promise<Contact>
  list(organizationId: string, opts?: { limit?: number }): Promise<Contact[]>
  getByPhone(organizationId: string, phone: string): Promise<Contact | null>
  getByEmail(organizationId: string, email: string): Promise<Contact | null>
  create(input: CreateContactInput): Promise<Contact>
  update(id: string, patch: UpdateContactInput): Promise<Contact>
  findByExternalKey(input: { organizationId: string; channel: string; externalKey: string }): Promise<Contact | null>
  upsertByExternalKey(input: UpsertByExternalKeyInput): Promise<Contact>
  resolveStaffByExternal(channelInstanceId: string, externalIdentifier: string): Promise<StaffBinding | null>
  readMemory(id: string): Promise<string>
  upsertMemorySection(id: string, heading: string, body: string): Promise<void>
  appendMemory(id: string, line: string): Promise<void>
  removeMemorySection(id: string, heading: string): Promise<void>
  setSegments(id: string, segments: string[]): Promise<void>
  setMarketingOptOut(id: string, value: boolean): Promise<void>
  bindStaff(userId: string, channelInstanceId: string, externalIdentifier: string): Promise<StaffBinding>
  remove(id: string): Promise<void>
}

export function createContactsService(deps: ContactsDeps): ContactsService {
  const db = deps.db as { select: Function; insert: Function; update: Function }
  const realtime = deps.realtime

  async function get(id: string): Promise<Contact> {
    const rows = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1)
    const row = rows[0]
    if (!row) throw new Error(`contact not found: ${id}`)
    return row as Contact
  }

  async function list(organizationId: string, opts?: { limit?: number }): Promise<Contact[]> {
    const baseQuery = db.select().from(contacts).where(eq(contacts.organizationId, organizationId))
    const rows = (opts?.limit ? await baseQuery.limit(opts.limit) : await baseQuery) as unknown[]
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

  async function findContactByExternalKey(input: {
    organizationId: string
    channel: string
    externalKey: string
  }): Promise<Contact | null> {
    const rows = (await db
      .select()
      .from(contacts)
      .innerJoin(contactExternalKeys, eq(contactExternalKeys.contactId, contacts.id))
      .where(
        and(
          eq(contactExternalKeys.organizationId, input.organizationId),
          eq(contactExternalKeys.channel, input.channel),
          eq(contactExternalKeys.externalKey, input.externalKey),
        ),
      )
      .limit(1)) as Array<{ contacts: Contact }>
    return rows[0]?.contacts ?? null
  }

  // Cross-channel merge — same person reachable on multiple channels collapses
  // to one contact when they share phone or email. Phone wins over email (more
  // reliable identity for a contact-driven channel). Used both before the
  // insert and to follow the winner after a concurrent-insert conflict.
  async function resolveContactIdByIdentity(input: UpsertByExternalKeyInput): Promise<string | null> {
    if (input.phone) {
      const rows = (await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.organizationId, input.organizationId), eq(contacts.phone, input.phone)))
        .limit(1)) as Array<{ id: string }>
      if (rows[0]) return rows[0].id
    }
    if (input.email) {
      const rows = (await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.organizationId, input.organizationId), eq(contacts.email, input.email)))
        .limit(1)) as Array<{ id: string }>
      if (rows[0]) return rows[0].id
    }
    return null
  }

  async function upsertByExternalKey(input: UpsertByExternalKeyInput): Promise<Contact> {
    const existing = await findContactByExternalKey(input)
    if (existing) return existing

    let contactId = await resolveContactIdByIdentity(input)

    let inserted = false
    if (!contactId) {
      // `onConflictDoNothing` makes the identity insert idempotent under the
      // `uq_contacts_tenant_phone` / `uq_contacts_tenant_email` unique indexes:
      // a concurrent upsert for the same person (e.g. a retried/redelivered
      // WhatsApp `smb_app_state_sync` burst running while the first delivery is
      // still in flight) races our SELECT-then-INSERT, and without this the
      // loser throws a duplicate-key error instead of resolving the winner.
      const rows = (await db
        .insert(contacts)
        .values({
          organizationId: input.organizationId,
          phone: input.phone ?? null,
          email: input.email ?? null,
          displayName: input.displayName ?? null,
        })
        .onConflictDoNothing()
        .returning({ id: contacts.id })) as Array<{ id: string }>
      contactId = rows[0]?.id ?? null
      if (contactId) {
        inserted = true
      } else {
        // We lost the race — re-resolve to follow the contact the winner created.
        contactId = await resolveContactIdByIdentity(input)
        if (!contactId) throw new Error('contacts/upsertByExternalKey: insert conflicted but no identity row resolved')
      }
    }

    // Idempotent key insert. If a concurrent inbound for the same
    // `(org, channel, externalKey)` already created the row, the conflict is
    // a no-op and we re-fetch to follow the winner — otherwise our orphan
    // contact would be returned and the next inbound would resolve to a
    // different row for the same person.
    await db
      .insert(contactExternalKeys)
      .values({
        organizationId: input.organizationId,
        channel: input.channel,
        externalKey: input.externalKey,
        contactId,
      })
      .onConflictDoNothing()

    if (inserted) safeNotify(realtime, { table: 'contacts', id: contactId, action: 'created' })

    return (await findContactByExternalKey(input)) ?? get(contactId)
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

  async function readMemory(id: string): Promise<string> {
    const rows = await db.select({ memory: contacts.memory }).from(contacts).where(eq(contacts.id, id)).limit(1)
    const row = rows[0]
    if (!row) throw new Error(`contact not found: ${id}`)
    return (row as { memory: string }).memory
  }

  async function writeMemoryIfChanged(id: string, current: string, next: string): Promise<void> {
    if (current === next) return
    await db.update(contacts).set({ memory: next }).where(eq(contacts.id, id))
    safeNotify(realtime, { table: 'contacts', id, action: 'memory_updated' })
  }

  async function upsertMemorySection(id: string, heading: string, body: string): Promise<void> {
    const current = await readMemory(id)
    await writeMemoryIfChanged(id, current, setSection(current, heading, body))
  }

  async function appendMemory(id: string, line: string): Promise<void> {
    const current = await readMemory(id)
    await writeMemoryIfChanged(id, current, current ? `${current}\n${line}` : line)
  }

  async function removeMemorySection(id: string, heading: string): Promise<void> {
    const current = await readMemory(id)
    await writeMemoryIfChanged(id, current, removeSection(current, heading))
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
    const created = row as Contact
    safeNotify(realtime, { table: 'contacts', id: created.id, action: 'created' })
    return created
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
    findByExternalKey: findContactByExternalKey,
    upsertByExternalKey,
    resolveStaffByExternal,
    readMemory,
    upsertMemorySection,
    appendMemory,
    removeMemorySection,
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
export function list(organizationId: string, opts?: { limit?: number }): Promise<Contact[]> {
  return current().list(organizationId, opts)
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
export function findByExternalKey(input: {
  organizationId: string
  channel: string
  externalKey: string
}): Promise<Contact | null> {
  return current().findByExternalKey(input)
}
export function upsertByExternalKey(input: UpsertByExternalKeyInput): Promise<Contact> {
  return current().upsertByExternalKey(input)
}
export function resolveStaffByExternal(
  channelInstanceId: string,
  externalIdentifier: string,
): Promise<StaffBinding | null> {
  return current().resolveStaffByExternal(channelInstanceId, externalIdentifier)
}
export function readMemory(id: string): Promise<string> {
  return current().readMemory(id)
}
export function upsertMemorySection(id: string, heading: string, body: string): Promise<void> {
  return current().upsertMemorySection(id, heading, body)
}
export function appendMemory(id: string, line: string): Promise<void> {
  return current().appendMemory(id, line)
}
export function removeMemorySection(id: string, heading: string): Promise<void> {
  return current().removeMemorySection(id, heading)
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
