/**
 * Staff attribute-definitions service — CRUD for `team.staff_attribute_definitions`
 * (org-scoped schema that types the `staff_profiles.attributes` JSONB).
 *
 * Mirrors `modules/contacts/service/attribute-definitions.ts` — duplicated
 * deliberately to keep the two attribute namespaces fully independent
 * (no polymorphic abstraction).
 */

import { staffAttributeDefinitions } from '@modules/team/schema'
import { asc, eq } from 'drizzle-orm'

import type { AttributeType, StaffAttributeDefinition } from '../schema'

export interface CreateStaffAttrDefInput {
  organizationId: string
  key: string
  label: string
  type: AttributeType
  options?: string[]
  showInTable?: boolean
  sortOrder?: number
}

export interface UpdateStaffAttrDefInput {
  label?: string
  type?: AttributeType
  options?: string[]
  showInTable?: boolean
  sortOrder?: number
}

export interface StaffAttrDefService {
  list(organizationId: string): Promise<StaffAttributeDefinition[]>
  create(input: CreateStaffAttrDefInput): Promise<StaffAttributeDefinition>
  update(id: string, patch: UpdateStaffAttrDefInput): Promise<StaffAttributeDefinition>
  remove(id: string): Promise<void>
}

interface Deps {
  db: unknown
}

export function createStaffAttrDefService(deps: Deps): StaffAttrDefService {
  const db = deps.db as { select: Function; insert: Function; update: Function; delete: Function }

  async function list(organizationId: string): Promise<StaffAttributeDefinition[]> {
    const rows = (await db
      .select()
      .from(staffAttributeDefinitions)
      .where(eq(staffAttributeDefinitions.organizationId, organizationId))
      .orderBy(asc(staffAttributeDefinitions.sortOrder), asc(staffAttributeDefinitions.key))) as unknown[]
    return rows as StaffAttributeDefinition[]
  }

  async function create(input: CreateStaffAttrDefInput): Promise<StaffAttributeDefinition> {
    const rows = (await db
      .insert(staffAttributeDefinitions)
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
    if (!row) throw new Error('staff-attribute-definitions/create: insert returned no rows')
    return row as StaffAttributeDefinition
  }

  async function update(id: string, patch: UpdateStaffAttrDefInput): Promise<StaffAttributeDefinition> {
    const rows = (await db
      .update(staffAttributeDefinitions)
      .set(patch)
      .where(eq(staffAttributeDefinitions.id, id))
      .returning()) as unknown[]
    const row = rows[0]
    if (!row) throw new Error(`staff-attribute-definition not found: ${id}`)
    return row as StaffAttributeDefinition
  }

  async function remove(id: string): Promise<void> {
    await db.delete(staffAttributeDefinitions).where(eq(staffAttributeDefinitions.id, id))
  }

  return { list, create, update, remove }
}

let _current: StaffAttrDefService | null = null

export function installStaffAttrDefService(svc: StaffAttrDefService): void {
  _current = svc
}

export function __resetStaffAttrDefServiceForTests(): void {
  _current = null
}

function currentSvc(): StaffAttrDefService {
  if (!_current) throw new Error('team/attribute-definitions: service not installed')
  return _current
}

export function listDefs(organizationId: string): Promise<StaffAttributeDefinition[]> {
  return currentSvc().list(organizationId)
}
export function createDef(input: CreateStaffAttrDefInput): Promise<StaffAttributeDefinition> {
  return currentSvc().create(input)
}
export function updateDef(id: string, patch: UpdateStaffAttrDefInput): Promise<StaffAttributeDefinition> {
  return currentSvc().update(id, patch)
}
export function removeDef(id: string): Promise<void> {
  return currentSvc().remove(id)
}
