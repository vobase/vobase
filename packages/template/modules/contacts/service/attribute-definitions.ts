/**
 * Attribute-definitions service.
 *
 * CRUD for `contact_attribute_definitions` (org-scoped schema that types the
 * `contacts.attributes` JSONB), plus helpers to patch a single contact's
 * attribute map. Callers go through `install*` + module-level wrappers to
 * match the surrounding contacts-service pattern.
 *
 * Each definition carries a 4-level `sensitivity` (`low|medium|high|critical`)
 * — operator-set per attribute. Routing through the changes module reads
 * those values via `resolveAttributeSensitivities` so a `field_set` payload
 * touching `attributes.medicalCondition` (critical) routes at `'critical'`
 * even when the contacts resource defaults to `'medium'`.
 */

import { contactAttributeDefinitions, contacts } from '@modules/contacts/schema'
import { asc, eq } from 'drizzle-orm'

import type {
  AttributeSensitivity,
  AttributeType,
  AttributeValue,
  Contact,
  ContactAttributeDefinition,
} from '../schema'

export interface CreateAttrDefInput {
  organizationId: string
  key: string
  label: string
  type: AttributeType
  options?: string[]
  showInTable?: boolean
  sensitivity?: AttributeSensitivity
  sortOrder?: number
}

export interface UpdateAttrDefInput {
  label?: string
  type?: AttributeType
  options?: string[]
  showInTable?: boolean
  sensitivity?: AttributeSensitivity
  sortOrder?: number
}

export interface AttrDefService {
  list(organizationId: string): Promise<ContactAttributeDefinition[]>
  create(input: CreateAttrDefInput): Promise<ContactAttributeDefinition>
  update(id: string, patch: UpdateAttrDefInput): Promise<ContactAttributeDefinition>
  remove(id: string): Promise<void>
  setContactValues(contactId: string, patch: Record<string, AttributeValue>): Promise<Contact>
  resolveSensitivities(organizationId: string, keys: readonly string[]): Promise<AttributeSensitivity[]>
}

interface Deps {
  db: unknown
}

export function createAttrDefService(deps: Deps): AttrDefService {
  const db = deps.db as { select: Function; insert: Function; update: Function; delete: Function }

  // Per-org cache of attribute key → sensitivity. Sized for typical tenants
  // (a handful of attribute keys per org). Invalidated on any local write
  // (sub-millisecond) and on a 60s TTL so multi-instance deployments
  // converge after at most one minute when a peer process mutates the table.
  // pg_notify-based cross-instance invalidation is the correct long-term fix
  // (matches `use-realtime-invalidation.ts`); deferred until any tenant
  // exceeds 60s tolerance for staleness.
  const CACHE_TTL_MS = 60_000
  const sensitivityCache = new Map<string, { map: Map<string, AttributeSensitivity>; loadedAt: number }>()

  function invalidateCache(organizationId: string): void {
    sensitivityCache.delete(organizationId)
  }

  async function loadSensitivityMap(organizationId: string): Promise<Map<string, AttributeSensitivity>> {
    const cached = sensitivityCache.get(organizationId)
    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.map
    const rows = (await db
      .select({
        key: contactAttributeDefinitions.key,
        sensitivity: contactAttributeDefinitions.sensitivity,
      })
      .from(contactAttributeDefinitions)
      .where(eq(contactAttributeDefinitions.organizationId, organizationId))) as unknown as {
      key: string
      sensitivity: AttributeSensitivity
    }[]
    const map = new Map<string, AttributeSensitivity>()
    for (const row of rows) map.set(row.key, row.sensitivity)
    sensitivityCache.set(organizationId, { map, loadedAt: Date.now() })
    return map
  }

  async function list(organizationId: string): Promise<ContactAttributeDefinition[]> {
    const rows = (await db
      .select()
      .from(contactAttributeDefinitions)
      .where(eq(contactAttributeDefinitions.organizationId, organizationId))
      .orderBy(asc(contactAttributeDefinitions.sortOrder), asc(contactAttributeDefinitions.key))) as unknown[]
    return rows as ContactAttributeDefinition[]
  }

  async function create(input: CreateAttrDefInput): Promise<ContactAttributeDefinition> {
    const rows = (await db
      .insert(contactAttributeDefinitions)
      .values({
        organizationId: input.organizationId,
        key: input.key,
        label: input.label,
        type: input.type,
        options: input.options ?? [],
        showInTable: input.showInTable ?? false,
        sensitivity: input.sensitivity ?? 'medium',
        sortOrder: input.sortOrder ?? 0,
      })
      .returning()) as unknown[]
    const row = rows[0]
    if (!row) throw new Error('attribute-definitions/create: insert returned no rows')
    invalidateCache(input.organizationId)
    return row as ContactAttributeDefinition
  }

  async function update(id: string, patch: UpdateAttrDefInput): Promise<ContactAttributeDefinition> {
    const rows = (await db
      .update(contactAttributeDefinitions)
      .set(patch)
      .where(eq(contactAttributeDefinitions.id, id))
      .returning()) as unknown[]
    const row = rows[0]
    if (!row) throw new Error(`attribute-definition not found: ${id}`)
    const updated = row as ContactAttributeDefinition
    invalidateCache(updated.organizationId)
    return updated
  }

  async function remove(id: string): Promise<void> {
    // Read the org id before delete so the cache invalidation lands on the
    // right entry. A single round-trip is cheap relative to the DELETE.
    const rows = (await db
      .select({ organizationId: contactAttributeDefinitions.organizationId })
      .from(contactAttributeDefinitions)
      .where(eq(contactAttributeDefinitions.id, id))
      .limit(1)) as unknown as { organizationId: string }[]
    await db.delete(contactAttributeDefinitions).where(eq(contactAttributeDefinitions.id, id))
    if (rows[0]) invalidateCache(rows[0].organizationId)
  }

  async function setContactValues(contactId: string, patch: Record<string, AttributeValue>): Promise<Contact> {
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

  async function resolveSensitivities(
    organizationId: string,
    keys: readonly string[],
  ): Promise<AttributeSensitivity[]> {
    if (keys.length === 0) return []
    const map = await loadSensitivityMap(organizationId)
    const out: AttributeSensitivity[] = []
    for (const key of keys) {
      // Unknown keys (the agent proposed an attribute the org hasn't defined)
      // fall back to `'medium'` — same default as the column. The contacts
      // materializer will reject the proposal at apply time, so the routing
      // decision here is moot for unknown keys.
      out.push(map.get(key) ?? 'medium')
    }
    return out
  }

  return { list, create, update, remove, setContactValues, resolveSensitivities }
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

/**
 * Cross-module entry point used by `changes/service/sensitivity.ts` to
 * resolve `attributes.<key>` sensitivities for `field_set` payloads. Wired
 * through the contacts module's `registerChangeMaterializer` call so the
 * resolver only fires for the contacts resource.
 */
export function resolveAttributeSensitivities(
  organizationId: string,
  keys: readonly string[],
): Promise<AttributeSensitivity[]> {
  return current().resolveSensitivities(organizationId, keys)
}
