/**
 * Staff-side mutations: reassign + SSE NOTIFY. Not journaled through the agent
 * write path — these are direct staff actions, not agent tool calls.
 */
import type { Conversation } from '@server/contracts/domain-types'

let _db: unknown = null

export function setDb(db: unknown): void {
  _db = db
}

function requireDb() {
  if (!_db) throw new Error('inbox/staff-ops: db not initialised — call setDb() in module init')
  return _db as { execute: Function; select: Function; update: Function }
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const { conversations } = await import('@modules/inbox/schema')
  const { eq } = await import('drizzle-orm')
  const db = requireDb()
  const rows = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1)
  return (rows[0] as Conversation) ?? null
}

export async function reassignConversation(id: string, assignee: string): Promise<Conversation> {
  const { conversations } = await import('@modules/inbox/schema')
  const { eq } = await import('drizzle-orm')
  const db = requireDb()
  const rows = await db
    .update(conversations)
    .set({ assignee, updatedAt: new Date() })
    .where(eq(conversations.id, id))
    .returning()
  const row = rows[0] as Conversation | undefined
  if (!row) throw new Error(`inbox/staff-ops.reassign: conversation ${id} not found`)
  return row
}

export async function notifyConversation(id: string): Promise<void> {
  if (!_db) return
  const { sql } = await import('drizzle-orm')
  const db = _db as { execute: Function }
  const payload = JSON.stringify({ table: 'conversations', id })
  await db.execute(sql`SELECT pg_notify('vobase_sse', ${payload})`)
}
