/**
 * Agent-scoped staff memory — one markdown blob per
 * (organization_id, agent_id, staff_id). Backed by `agents.agent_staff_memory`.
 *
 * Read surface: `/staff/<staffId>/MEMORY.md` materializer (per-wake, scoped by
 * the active agent). Write surface: the workspace-sync observer dispatches
 * `staffMemory` diffs here on `agent_end`.
 */

import { agentStaffMemory } from '@modules/agents/schema'
import { and, eq } from 'drizzle-orm'

export interface StaffMemoryKey {
  organizationId: string
  agentId: string
  staffId: string
}

export interface StaffMemoryService {
  read(key: StaffMemoryKey): Promise<string>
  upsert(key: StaffMemoryKey, content: string): Promise<void>
}

interface StaffMemoryDeps {
  db: unknown
}

export function createStaffMemoryService(deps: StaffMemoryDeps): StaffMemoryService {
  const db = deps.db as { select: Function; insert: Function }

  async function read(key: StaffMemoryKey): Promise<string> {
    const rows = (await db
      .select({ content: agentStaffMemory.content })
      .from(agentStaffMemory)
      .where(
        and(
          eq(agentStaffMemory.organizationId, key.organizationId),
          eq(agentStaffMemory.agentId, key.agentId),
          eq(agentStaffMemory.staffId, key.staffId),
        ),
      )
      .limit(1)) as Array<{ content: string }>
    return rows[0]?.content ?? ''
  }

  async function upsert(key: StaffMemoryKey, content: string): Promise<void> {
    await db
      .insert(agentStaffMemory)
      .values({
        organizationId: key.organizationId,
        agentId: key.agentId,
        staffId: key.staffId,
        content,
      })
      .onConflictDoUpdate({
        target: [agentStaffMemory.organizationId, agentStaffMemory.agentId, agentStaffMemory.staffId],
        set: { content, updatedAt: new Date() },
      })
  }

  return { read, upsert }
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

export function upsertStaffMemory(key: StaffMemoryKey, content: string): Promise<void> {
  return current().upsert(key, content)
}
