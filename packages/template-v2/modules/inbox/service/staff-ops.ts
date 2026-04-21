/**
 * Staff-side mutations: reassign + SSE NOTIFY. Not journaled through the agent
 * write path — these are direct staff actions, not agent tool calls.
 *
 * Factory-DI service. Free-function wrappers route through the
 * installed instance to preserve the existing import surface.
 */
import type { Conversation } from '../schema'

type StaffOpsDb = { execute: Function; select: Function; update: Function }

export interface StaffOpsService {
  getConversation(id: string): Promise<Conversation | null>
  reassignConversation(id: string, assignee: string): Promise<Conversation>
  notifyConversation(id: string): Promise<void>
}

export interface StaffOpsServiceDeps {
  db: unknown
}

export function createStaffOpsService(deps: StaffOpsServiceDeps): StaffOpsService {
  const db = deps.db as StaffOpsDb

  async function getConversation(id: string): Promise<Conversation | null> {
    const { conversations } = await import('@modules/inbox/schema')
    const { eq } = await import('drizzle-orm')
    const rows = await (db as { select: Function })
      .select()
      .from(conversations)
      .where(eq(conversations.id, id))
      .limit(1)
    return (rows[0] as Conversation) ?? null
  }

  async function reassignConversation(id: string, assignee: string): Promise<Conversation> {
    const { conversations } = await import('@modules/inbox/schema')
    const { eq } = await import('drizzle-orm')
    const rows = await (db as { update: Function })
      .update(conversations)
      .set({ assignee, updatedAt: new Date() })
      .where(eq(conversations.id, id))
      .returning()
    const row = rows[0] as Conversation | undefined
    if (!row) throw new Error(`inbox/staff-ops.reassign: conversation ${id} not found`)
    return row
  }

  async function notifyConversation(id: string): Promise<void> {
    const { sql } = await import('drizzle-orm')
    const payload = JSON.stringify({ table: 'conversations', id })
    await (db as { execute: Function }).execute(sql`SELECT pg_notify('vobase_events', ${payload})`)
  }

  return { getConversation, reassignConversation, notifyConversation }
}

let _currentStaffOpsService: StaffOpsService | null = null

export function installStaffOpsService(svc: StaffOpsService): void {
  _currentStaffOpsService = svc
}

export function __resetStaffOpsServiceForTests(): void {
  _currentStaffOpsService = null
}

function current(): StaffOpsService {
  if (!_currentStaffOpsService) {
    throw new Error('inbox/staff-ops: service not installed — call installStaffOpsService() in module init')
  }
  return _currentStaffOpsService
}

export async function getConversation(id: string): Promise<Conversation | null> {
  return current().getConversation(id)
}

export async function reassignConversation(id: string, assignee: string): Promise<Conversation> {
  return current().reassignConversation(id, assignee)
}

export async function notifyConversation(id: string): Promise<void> {
  if (!_currentStaffOpsService) return
  return _currentStaffOpsService.notifyConversation(id)
}
