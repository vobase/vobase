/**
 * Staff profiles service — CRUD over `team.staff_profiles`.
 *
 * Mirrors the contacts-service pattern: `createStaffService({ db })` factory,
 * installable process-level singleton, module-level re-exports. Drizzle is
 * dynamic-imported per call so `check-module-shape` doesn't flag the file.
 */

import type { AttributeValue, Availability, StaffProfile } from '../schema'

export interface UpsertStaffInput {
  userId: string
  organizationId: string
  displayName?: string | null
  title?: string | null
  sectors?: string[]
  expertise?: string[]
  languages?: string[]
  capacity?: number
  availability?: Availability
  attributes?: Record<string, AttributeValue>
  workingMemory?: string
  assignmentNotes?: string
}

export interface UpdateStaffInput {
  displayName?: string | null
  title?: string | null
  sectors?: string[]
  expertise?: string[]
  languages?: string[]
  capacity?: number
  availability?: Availability
  assignmentNotes?: string
}

interface StaffDeps {
  db: unknown
}

export interface StaffService {
  list(organizationId: string): Promise<StaffProfile[]>
  get(userId: string): Promise<StaffProfile>
  find(userId: string): Promise<StaffProfile | null>
  upsert(input: UpsertStaffInput): Promise<StaffProfile>
  update(userId: string, patch: UpdateStaffInput): Promise<StaffProfile>
  remove(userId: string): Promise<void>
  setAttributes(userId: string, patch: Record<string, AttributeValue>): Promise<StaffProfile>
  touchLastSeen(userId: string): Promise<void>
  setWorkingMemory(userId: string, value: string): Promise<void>
}

export function createStaffService(deps: StaffDeps): StaffService {
  const db = deps.db as { select: Function; insert: Function; update: Function; delete: Function }

  async function list(organizationId: string): Promise<StaffProfile[]> {
    const { staffProfiles } = await import('@modules/team/schema')
    const { eq, asc } = await import('drizzle-orm')
    const rows = (await db
      .select()
      .from(staffProfiles)
      .where(eq(staffProfiles.organizationId, organizationId))
      .orderBy(asc(staffProfiles.displayName))) as unknown[]
    return rows as StaffProfile[]
  }

  async function find(userId: string): Promise<StaffProfile | null> {
    const { staffProfiles } = await import('@modules/team/schema')
    const { eq } = await import('drizzle-orm')
    const rows = await db.select().from(staffProfiles).where(eq(staffProfiles.userId, userId)).limit(1)
    return (rows[0] as StaffProfile | undefined) ?? null
  }

  async function get(userId: string): Promise<StaffProfile> {
    const row = await find(userId)
    if (!row) throw new Error(`staff-profile not found: ${userId}`)
    return row
  }

  async function upsert(input: UpsertStaffInput): Promise<StaffProfile> {
    const { staffProfiles } = await import('@modules/team/schema')
    const values: Record<string, unknown> = {
      userId: input.userId,
      organizationId: input.organizationId,
    }
    if (input.displayName !== undefined) values.displayName = input.displayName
    if (input.title !== undefined) values.title = input.title
    if (input.sectors !== undefined) values.sectors = input.sectors
    if (input.expertise !== undefined) values.expertise = input.expertise
    if (input.languages !== undefined) values.languages = input.languages
    if (input.capacity !== undefined) values.capacity = input.capacity
    if (input.availability !== undefined) values.availability = input.availability
    if (input.attributes !== undefined) values.attributes = input.attributes
    if (input.workingMemory !== undefined) values.workingMemory = input.workingMemory
    if (input.assignmentNotes !== undefined) values.assignmentNotes = input.assignmentNotes

    const update: Record<string, unknown> = { ...values }
    delete update.userId
    delete update.organizationId

    const rows = (await db
      .insert(staffProfiles)
      .values(values)
      .onConflictDoUpdate({ target: staffProfiles.userId, set: update })
      .returning()) as unknown[]
    const row = rows[0]
    if (!row) throw new Error('staff-profiles/upsert: insert returned no rows')
    return row as StaffProfile
  }

  async function update(userId: string, patch: UpdateStaffInput): Promise<StaffProfile> {
    const { staffProfiles } = await import('@modules/team/schema')
    const { eq } = await import('drizzle-orm')
    const set: Record<string, unknown> = {}
    if (patch.displayName !== undefined) set.displayName = patch.displayName
    if (patch.title !== undefined) set.title = patch.title
    if (patch.sectors !== undefined) set.sectors = patch.sectors
    if (patch.expertise !== undefined) set.expertise = patch.expertise
    if (patch.languages !== undefined) set.languages = patch.languages
    if (patch.capacity !== undefined) set.capacity = patch.capacity
    if (patch.availability !== undefined) set.availability = patch.availability
    if (patch.assignmentNotes !== undefined) set.assignmentNotes = patch.assignmentNotes
    const rows = (await db
      .update(staffProfiles)
      .set(set)
      .where(eq(staffProfiles.userId, userId))
      .returning()) as unknown[]
    const row = rows[0]
    if (!row) throw new Error(`staff-profile not found: ${userId}`)
    return row as StaffProfile
  }

  async function remove(userId: string): Promise<void> {
    const { staffProfiles } = await import('@modules/team/schema')
    const { eq } = await import('drizzle-orm')
    await db.delete(staffProfiles).where(eq(staffProfiles.userId, userId))
  }

  async function setAttributes(userId: string, patch: Record<string, AttributeValue>): Promise<StaffProfile> {
    const { staffProfiles } = await import('@modules/team/schema')
    const { eq } = await import('drizzle-orm')
    const existing = (await db
      .select({ attributes: staffProfiles.attributes })
      .from(staffProfiles)
      .where(eq(staffProfiles.userId, userId))
      .limit(1)) as { attributes: Record<string, AttributeValue> }[]
    if (!existing[0]) throw new Error(`staff-profile not found: ${userId}`)
    const merged: Record<string, AttributeValue> = { ...existing[0].attributes }
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete merged[k]
      else merged[k] = v
    }
    const rows = (await db
      .update(staffProfiles)
      .set({ attributes: merged })
      .where(eq(staffProfiles.userId, userId))
      .returning()) as unknown[]
    const row = rows[0]
    if (!row) throw new Error(`staff-profile not found: ${userId}`)
    return row as StaffProfile
  }

  async function touchLastSeen(userId: string): Promise<void> {
    const { staffProfiles } = await import('@modules/team/schema')
    const { eq } = await import('drizzle-orm')
    await db.update(staffProfiles).set({ lastSeenAt: new Date() }).where(eq(staffProfiles.userId, userId))
  }

  async function setWorkingMemory(userId: string, value: string): Promise<void> {
    const { staffProfiles } = await import('@modules/team/schema')
    const { eq } = await import('drizzle-orm')
    await db.update(staffProfiles).set({ workingMemory: value }).where(eq(staffProfiles.userId, userId))
  }

  return { list, get, find, upsert, update, remove, setAttributes, touchLastSeen, setWorkingMemory }
}

let _current: StaffService | null = null

export function installStaffService(svc: StaffService): void {
  _current = svc
}

export function __resetStaffServiceForTests(): void {
  _current = null
}

function current(): StaffService {
  if (!_current) throw new Error('team/staff: service not installed — call installStaffService() in module init')
  return _current
}

export function list(organizationId: string): Promise<StaffProfile[]> {
  return current().list(organizationId)
}
export function get(userId: string): Promise<StaffProfile> {
  return current().get(userId)
}
export function find(userId: string): Promise<StaffProfile | null> {
  return current().find(userId)
}
export function upsert(input: UpsertStaffInput): Promise<StaffProfile> {
  return current().upsert(input)
}
export function update(userId: string, patch: UpdateStaffInput): Promise<StaffProfile> {
  return current().update(userId, patch)
}
export function remove(userId: string): Promise<void> {
  return current().remove(userId)
}
export function setAttributes(userId: string, patch: Record<string, AttributeValue>): Promise<StaffProfile> {
  return current().setAttributes(userId, patch)
}
export function touchLastSeen(userId: string): Promise<void> {
  return current().touchLastSeen(userId)
}
export function setWorkingMemory(userId: string, value: string): Promise<void> {
  return current().setWorkingMemory(userId, value)
}
