/**
 * Agent-scoped staff memory — one markdown blob per
 * (organization_id, agent_id, staff_id). Backed by `agents.agent_staff_memory`.
 *
 * Read surface: `/staff/<staffId>/MEMORY.md` materializer (per-wake, scoped by
 * the active agent). Write surface: the workspace-sync observer dispatches
 * `staffMemory` diffs here on `agent_end`.
 */

import { agentDefinitions, agentStaffMemory } from '@modules/agents/schema'
import { and, eq } from 'drizzle-orm'

import type { RealtimeService } from '~/runtime'

export interface StaffMemoryKey {
  organizationId: string
  agentId: string
  staffId: string
}

export interface StaffMemoryEntry {
  agentId: string
  agentName: string
  memory: string
  updatedAt: Date
}

export interface StaffMemoryService {
  read(key: StaffMemoryKey): Promise<string>
  upsert(key: StaffMemoryKey, memory: string): Promise<void>
  /** Every (agent, staff) memory blob for one staff member, joined with the agent's display name. */
  listByStaff(input: { organizationId: string; staffId: string }): Promise<StaffMemoryEntry[]>
}

interface StaffMemoryDeps {
  db: unknown
  realtime: RealtimeService
}

export function createStaffMemoryService(deps: StaffMemoryDeps): StaffMemoryService {
  const db = deps.db as { select: Function; insert: Function }
  const realtime = deps.realtime

  async function read(key: StaffMemoryKey): Promise<string> {
    const rows = (await db
      .select({ memory: agentStaffMemory.memory })
      .from(agentStaffMemory)
      .where(
        and(
          eq(agentStaffMemory.organizationId, key.organizationId),
          eq(agentStaffMemory.agentId, key.agentId),
          eq(agentStaffMemory.staffId, key.staffId),
        ),
      )
      .limit(1)) as Array<{ memory: string }>
    return rows[0]?.memory ?? ''
  }

  async function upsert(key: StaffMemoryKey, memory: string): Promise<void> {
    const existing = (await db
      .select({ memory: agentStaffMemory.memory })
      .from(agentStaffMemory)
      .where(
        and(
          eq(agentStaffMemory.organizationId, key.organizationId),
          eq(agentStaffMemory.agentId, key.agentId),
          eq(agentStaffMemory.staffId, key.staffId),
        ),
      )
      .limit(1)) as Array<{ memory: string }>
    const isNoOp = existing[0]?.memory === memory
    await db
      .insert(agentStaffMemory)
      .values({
        organizationId: key.organizationId,
        agentId: key.agentId,
        staffId: key.staffId,
        memory,
      })
      .onConflictDoUpdate({
        target: [agentStaffMemory.organizationId, agentStaffMemory.agentId, agentStaffMemory.staffId],
        set: { memory, updatedAt: new Date() },
      })
    if (!isNoOp) {
      try {
        realtime.notify({
          table: 'agent_staff_memory',
          action: 'upserted',
          resourceModule: 'agents',
          resourceType: 'staff_memory',
          resourceId: key.staffId,
        })
      } catch {
        // notify is best-effort
      }
    }
  }

  async function listByStaff(input: { organizationId: string; staffId: string }): Promise<StaffMemoryEntry[]> {
    // biome-ignore lint/suspicious/noExplicitAny: drizzle scoped-db typing
    const dbAny = db as any
    const rows = (await dbAny
      .select({
        agentId: agentStaffMemory.agentId,
        agentName: agentDefinitions.name,
        memory: agentStaffMemory.memory,
        updatedAt: agentStaffMemory.updatedAt,
      })
      .from(agentStaffMemory)
      .innerJoin(agentDefinitions, eq(agentDefinitions.id, agentStaffMemory.agentId))
      .where(
        and(eq(agentStaffMemory.organizationId, input.organizationId), eq(agentStaffMemory.staffId, input.staffId)),
      )) as StaffMemoryEntry[]
    return rows
  }

  return { read, upsert, listByStaff }
}

let _current: StaffMemoryService | null = null

export function installStaffMemoryService(svc: StaffMemoryService): void {
  _current = svc
}

export function __resetStaffMemoryServiceForTests(): void {
  _current = null
}

function current(): StaffMemoryService {
  if (!_current) {
    throw new Error('agents/staff-memory: service not installed — call installStaffMemoryService() in module init')
  }
  return _current
}

export function readStaffMemory(key: StaffMemoryKey): Promise<string> {
  return current().read(key)
}

export function upsertStaffMemory(key: StaffMemoryKey, memory: string): Promise<void> {
  return current().upsert(key, memory)
}

export function listStaffMemoryByStaff(input: {
  organizationId: string
  staffId: string
}): Promise<StaffMemoryEntry[]> {
  return current().listByStaff(input)
}
