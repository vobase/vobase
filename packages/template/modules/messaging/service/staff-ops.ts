/**
 * Staff-side mutations: reassign + SSE NOTIFY. Not journaled through the agent
 * write path — these are direct staff actions, not agent tool calls.
 *
 * Factory-DI service. Free-function wrappers route through the
 * installed instance to preserve the existing import surface.
 */

import { TYPING_ACTIONS, type TypingActor } from '@modules/messaging/lib/typing-actions'
import { conversations } from '@modules/messaging/schema'
import { eq, sql } from 'drizzle-orm'

import type { Conversation } from '../schema'

type StaffOpsDb = { execute: Function; select: Function; update: Function }

export interface StaffOpsService {
  getConversation(id: string): Promise<Conversation | null>
  reassignConversation(id: string, assignee: string): Promise<Conversation>
  notifyConversation(id: string): Promise<void>
  /**
   * Broadcast a transient typing-presence signal for this conversation. The
   * `actor` is encoded in the `action` field as `typing.<actor>` so each side
   * can filter out its own beacons (a customer chat ignores `typing.customer`
   * events, the staff inbox ignores `typing.staff`). Not persisted — receivers
   * show an indicator for ~3s then clear.
   */
  notifyTyping(id: string, userId: string, userName: string, actor: TypingActor): Promise<void>
}

export interface StaffOpsServiceDeps {
  db: unknown
}

export function createStaffOpsService(deps: StaffOpsServiceDeps): StaffOpsService {
  const db = deps.db as StaffOpsDb

  async function getConversation(id: string): Promise<Conversation | null> {
    const rows = await (db as { select: Function })
      .select()
      .from(conversations)
      .where(eq(conversations.id, id))
      .limit(1)
    return (rows[0] as Conversation) ?? null
  }

  async function reassignConversation(id: string, assignee: string): Promise<Conversation> {
    const rows = await (db as { update: Function })
      .update(conversations)
      .set({ assignee, updatedAt: new Date() })
      .where(eq(conversations.id, id))
      .returning()
    const row = rows[0] as Conversation | undefined
    if (!row) throw new Error(`messaging/staff-ops.reassign: conversation ${id} not found`)
    return row
  }

  async function notifyConversation(id: string): Promise<void> {
    const payload = JSON.stringify({ table: 'conversations', id })
    await (db as { execute: Function }).execute(sql`SELECT pg_notify('vobase_events', ${payload})`)
  }

  async function notifyTyping(id: string, userId: string, userName: string, actor: TypingActor): Promise<void> {
    const payload = JSON.stringify({
      table: 'conversations',
      id,
      action: TYPING_ACTIONS[actor],
      userId,
      userName,
    })
    await (db as { execute: Function }).execute(sql`SELECT pg_notify('vobase_events', ${payload})`)
  }

  return { getConversation, reassignConversation, notifyConversation, notifyTyping }
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
    throw new Error('messaging/staff-ops: service not installed — call installStaffOpsService() in module init')
  }
  return _currentStaffOpsService
}

// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function getConversation(id: string): Promise<Conversation | null> {
  return current().getConversation(id)
}

// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function reassignConversation(id: string, assignee: string): Promise<Conversation> {
  return current().reassignConversation(id, assignee)
}

// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function notifyConversation(id: string): Promise<void> {
  if (!_currentStaffOpsService) return
  return _currentStaffOpsService.notifyConversation(id)
}

// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function notifyTyping(id: string, userId: string, userName: string, actor: TypingActor): Promise<void> {
  if (!_currentStaffOpsService) return
  return _currentStaffOpsService.notifyTyping(id, userId, userName, actor)
}
