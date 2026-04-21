/**
 * Attribute-definitions service.
 *
 * CRUD for `contact_attribute_definitions` (org-scoped schema that types the
 * `contacts.attributes` JSONB), plus helpers to patch a single contact's
 * attribute map. Callers go through `install*` + module-level wrappers to
 * match the surrounding contacts-service pattern.
 */

import type { AttributeType, AttributeValue, Contact, ContactAttributeDefinition } from '../schema'

export interface CreateAttrDefInput {
  organizationId: string
  key: string
  label: string
  type: AttributeType
  options?: string[]
  showInTable?: boolean
  sortOrder?: number
}

export interface UpdateAttrDefInput {
  label?: string
  type?: AttributeType
  options?: string[]
  showInTable?: boolean
  sortOrder?: number
}

export interface AttrDefService {
  list(organizationId: string): Promise<ContactAttributeDefinition[]>
  create(input: CreateAttrDefInput): Promise<ContactAttributeDefinition>
  update(id: string, patch: UpdateAttrDefInput): Promise<ContactAttributeDefinition>
  remove(id: string): Promise<void>
  setContactValues(contactId: string, patch: Record<string, AttributeValue>): Promise<Contact>
}

interface Deps {
  db: unknown
}

export function createAttrDefService(deps: Deps): AttrDefService {
  const db = deps.db as { select: Function; insert: Function; update: Function; delete: Function }

  async function list(organizationId: string): Promise<ContactAttributeDefinition[]> {
    const { contactAttributeDefinitions } = await import('@modules/contacts/schema')
    const { eq, asc } = await import('drizzle-orm')
    const rows = (await db
      .select()
      .from(contactAttributeDefinitions)
      .where(eq(contactAttributeDefinitions.organizationId, organizationId))
      .orderBy(asc(contactAttributeDefinitions.sortOrder), asc(contactAttributeDefinitions.key))) as unknown[]
    return rows as ContactAttributeDefinition[]
  }

  async function create(input: CreateAttrDefInput): Promise<ContactAttributeDefinition> {
    const { contactAttributeDefinitions } = await import('@modules/contacts/schema')
    const rows = (await db
      .insert(contactAttributeDefinitions)
      .values({
        organizationId: input.organizationId,
        key: input.key,
        label: input.label,
        type: input.type,
        options: input.options ?? [],
        showInTable: input.showInTable ?? false,
        sortOrder: input.sortOrder ?? 0,
      })
      .returning()) as unknown[]
    const row = rows[0]
    if (!row) throw new Error('attribute-definitions/create: insert returned no rows')
    return row as ContactAttributeDefinition
  }

  async function update(id: string, patch: UpdateAttrDefInput): Promise<ContactAttributeDefinition> {
    const { contactAttributeDefinitions } = await import('@modules/contacts/schema')
    const { eq } = await import('drizzle-orm')
    const rows = (await db
      .update(contactAttributeDefinitions)
      .set(patch)
      .where(eq(contactAttributeDefinitions.id, id))
      .returning()) as unknown[]
    const row = rows[0]
    if (!row) throw new Error(`attribute-definition not found: ${id}`)
    return row as ContactAttributeDefinition
  }

  async function remove(id: string): Promise<void> {
    const { contactAttributeDefinitions } = await import('@modules/contacts/schema')
    const { eq } = await import('drizzle-orm')
    await db.delete(contactAttributeDefinitions).where(eq(contactAttributeDefinitions.id, id))
  }

  async function setContactValues(contactId: string, patch: Record<string, AttributeValue>): Promise<Contact> {
    const { contacts } = await import('@modules/contacts/schema')
    const { eq } = await import('drizzle-orm')
    const existing = (await db
      .select({ attributes: contacts.attributes })
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1)) as { attributes: Record<string, AttributeValue> }[]
    if (!existing[0]) throw new Error(`contact not found: ${contactId}`)
    const merged: Record<string, AttributeValue> = { ...existing[0].attributes }
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete merged[k]
      else merged[k] = v
    }
    const rows = (await db
      .update(contacts)
      .set({ attributes: merged })
      .where(eq(contacts.id, contactId))
      .returning()) as unknown[]
    const row = rows[0]
    if (!row) throw new Error(`contact not found: ${contactId}`)
    return row as Contact
  }

  return { list, create, update, remove, setContactValues }
}

let _current: AttrDefService | null = null

export function installAttrDefService(svc: AttrDefService): void {
  _current = svc
}

export function __resetAttrDefServiceForTests(): void {
  _current = null
}

function current(): AttrDefService {
  if (!_current) throw new Error('contacts/attribute-definitions: service not installed')
  return _current
}

export function listDefs(organizationId: string): Promise<ContactAttributeDefinition[]> {
  return current().list(organizationId)
}
export function createDef(input: CreateAttrDefInput): Promise<ContactAttributeDefinition> {
  return current().create(input)
}
export function updateDef(id: string, patch: UpdateAttrDefInput): Promise<ContactAttributeDefinition> {
  return current().update(id, patch)
}
export function removeDef(id: string): Promise<void> {
  return current().remove(id)
}
export function setContactAttributeValues(contactId: string, patch: Record<string, AttributeValue>): Promise<Contact> {
  return current().setContactValues(contactId, patch)
}
