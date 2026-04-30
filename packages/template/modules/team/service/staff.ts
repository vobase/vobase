/**
 * Staff profiles service — CRUD over `team.staff_profiles`.
 *
 * Mirrors the contacts-service pattern: `createStaffService({ db })` factory,
 * installable process-level singleton, module-level re-exports. Drizzle is
 * dynamic-imported per call so `check-module-shape` doesn't flag the file.
 */

import { staffProfiles } from '@modules/team/schema'
import { asc, eq } from 'drizzle-orm'

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
  profile?: string
  memory?: string
}

export interface UpdateStaffInput {
  displayName?: string | null
  title?: string | null
  sectors?: string[]
  expertise?: string[]
  languages?: string[]
  capacity?: number
  availability?: Availability
  profile?: string
  memory?: string
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
  readMemory(userId: string): Promise<string>
  writeMemory(userId: string, value: string): Promise<void>
  upsertMemorySection(userId: string, heading: string, body: string): Promise<void>
  readProfile(userId: string): Promise<string>
  writeProfile(userId: string, value: string): Promise<void>
}

export function createStaffService(deps: StaffDeps): StaffService {
  const db = deps.db as { select: Function; insert: Function; update: Function; delete: Function }

  async function list(organizationId: string): Promise<StaffProfile[]> {
    const rows = (await db
      .select()
      .from(staffProfiles)
      .where(eq(staffProfiles.organizationId, organizationId))
      .orderBy(asc(staffProfiles.displayName))) as unknown[]
    return rows as StaffProfile[]
  }

  async function find(userId: string): Promise<StaffProfile | null> {
    const rows = await db.select().from(staffProfiles).where(eq(staffProfiles.userId, userId)).limit(1)
    return (rows[0] as StaffProfile | undefined) ?? null
  }

  async function get(userId: string): Promise<StaffProfile> {
    const row = await find(userId)
    if (!row) throw new Error(`staff-profile not found: ${userId}`)
    return row
  }

  async function upsert(input: UpsertStaffInput): Promise<StaffProfile> {
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
    if (input.profile !== undefined) values.profile = input.profile
    if (input.memory !== undefined) values.memory = input.memory

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
    const set: Record<string, unknown> = {}
    if (patch.displayName !== undefined) set.displayName = patch.displayName
    if (patch.title !== undefined) set.title = patch.title
    if (patch.sectors !== undefined) set.sectors = patch.sectors
    if (patch.expertise !== undefined) set.expertise = patch.expertise
    if (patch.languages !== undefined) set.languages = patch.languages
    if (patch.capacity !== undefined) set.capacity = patch.capacity
    if (patch.availability !== undefined) set.availability = patch.availability
    if (patch.profile !== undefined) set.profile = patch.profile
    if (patch.memory !== undefined) set.memory = patch.memory
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
    await db.delete(staffProfiles).where(eq(staffProfiles.userId, userId))
  }

  async function setAttributes(userId: string, patch: Record<string, AttributeValue>): Promise<StaffProfile> {
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
    await db.update(staffProfiles).set({ lastSeenAt: new Date() }).where(eq(staffProfiles.userId, userId))
  }

  async function readColumn(userId: string, field: 'profile' | 'memory'): Promise<string> {
    const rows = (await db
      .select({ profile: staffProfiles.profile, memory: staffProfiles.memory })
      .from(staffProfiles)
      .where(eq(staffProfiles.userId, userId))
      .limit(1)) as Array<{ profile: string; memory: string }>
    const row = rows[0]
    if (!row) throw new Error(`staff-profile not found: ${userId}`)
    return row[field] ?? ''
  }

  async function writeColumn(userId: string, field: 'profile' | 'memory', value: string): Promise<void> {
    await db
      .update(staffProfiles)
      .set({ [field]: value })
      .where(eq(staffProfiles.userId, userId))
  }

  // biome-ignore lint/suspicious/useAwait: contract requires async signature
  async function readMemory(userId: string): Promise<string> {
    return readColumn(userId, 'memory')
  }
  async function writeMemory(userId: string, value: string): Promise<void> {
    await writeColumn(userId, 'memory', value)
  }
  async function upsertMemorySection(userId: string, heading: string, body: string): Promise<void> {
    const current = await readMemory(userId)
    await writeMemory(userId, setSection(current, heading, body))
  }
  // biome-ignore lint/suspicious/useAwait: contract requires async signature
  async function readProfile(userId: string): Promise<string> {
    return readColumn(userId, 'profile')
  }
  async function writeProfile(userId: string, value: string): Promise<void> {
    await writeColumn(userId, 'profile', value)
  }

  return {
    list,
    get,
    find,
    upsert,
    update,
    remove,
    setAttributes,
    touchLastSeen,
    readMemory,
    writeMemory,
    upsertMemorySection,
    readProfile,
    writeProfile,
  }
}

/** Upsert a `##` section in raw markdown — preserves all other sections. Mirrors contacts. */
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
export function readMemory(userId: string): Promise<string> {
  return current().readMemory(userId)
}
export function writeMemory(userId: string, value: string): Promise<void> {
  return current().writeMemory(userId, value)
}
export function upsertMemorySection(userId: string, heading: string, body: string): Promise<void> {
  return current().upsertMemorySection(userId, heading, body)
}
export function readProfile(userId: string): Promise<string> {
  return current().readProfile(userId)
}
export function writeProfile(userId: string, value: string): Promise<void> {
  return current().writeProfile(userId, value)
}
