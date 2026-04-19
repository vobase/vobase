/**
 * REAL Phase 1+2 — conversation writes.
 */
import type { Conversation, Message } from '@server/contracts/domain-types'
import type {
  CreateConversationInput,
  CreateInboundMessageInput,
  CreateInboundMessageResult,
} from '@server/contracts/inbox-port'

let _db: unknown = null

export function setDb(db: unknown): void {
  _db = db
}

function requireDb(): unknown {
  if (!_db) throw new Error('inbox/conversations: db not initialised — call setDb() in module init')
  return _db
}

export async function create(input: CreateConversationInput): Promise<Conversation> {
  const { conversations } = await import('@modules/inbox/schema')
  const db = requireDb() as { insert: Function }

  const rows = await db
    .insert(conversations)
    .values({
      tenantId: input.tenantId,
      contactId: input.contactId,
      channelInstanceId: input.channelInstanceId,
      status: input.status,
      assignee: input.assignee,
    })
    .returning()

  const row = rows[0]
  if (!row) throw new Error('inbox/conversations.create: insert returned no rows')
  return row as Conversation
}

/** Phase 2 — find active conversation or create a new one. Deduped by contactId + channelInstanceId. */
export async function resumeOrCreate(
  tenantId: string,
  contactId: string,
  channelInstanceId: string,
): Promise<{ conversation: Conversation; created: boolean }> {
  const { conversations } = await import('@modules/inbox/schema')
  const { eq, and, inArray } = await import('drizzle-orm')
  const db = requireDb() as { select: Function; insert: Function }

  const active = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.tenantId, tenantId),
        eq(conversations.contactId, contactId),
        eq(conversations.channelInstanceId, channelInstanceId),
        inArray(conversations.status, ['active', 'awaiting_approval']),
      ),
    )
    .limit(1)

  if (active[0]) return { conversation: active[0] as Conversation, created: false }

  const rows = await db
    .insert(conversations)
    .values({
      tenantId,
      contactId,
      channelInstanceId,
      status: 'active',
      assignee: 'unassigned',
    })
    .returning()

  const row = rows[0]
  if (!row) throw new Error('inbox/conversations.resumeOrCreate: insert returned no rows')
  return { conversation: row as Conversation, created: true }
}

/** Phase 2 — inbound write path. Idempotent by externalMessageId. */
export async function createInboundMessage(input: CreateInboundMessageInput): Promise<CreateInboundMessageResult> {
  const { conversation } = await resumeOrCreate(input.tenantId, input.contactId, input.channelInstanceId)
  const { messages } = await import('@modules/inbox/schema')
  const { eq, and } = await import('drizzle-orm')
  const db = requireDb() as { select: Function; insert: Function }

  // Dedup check
  const existing = await db
    .select()
    .from(messages)
    .where(and(eq(messages.tenantId, input.tenantId), eq(messages.channelExternalId, input.externalMessageId)))
    .limit(1)

  if (existing[0]) return { conversation, message: existing[0] as Message, isNew: false }

  const kind = input.contentType === 'image' ? 'image' : 'text'
  const rows = await db
    .insert(messages)
    .values({
      conversationId: conversation.id,
      tenantId: input.tenantId,
      role: 'customer',
      kind,
      content: { text: input.content },
      channelExternalId: input.externalMessageId,
    })
    .returning()

  const row = rows[0]
  if (!row) throw new Error('inbox/conversations.createInboundMessage: insert returned no rows')
  return { conversation, message: row as Message, isNew: true }
}

export async function get(id: string): Promise<Conversation> {
  const { conversations } = await import('@modules/inbox/schema')
  const { eq } = await import('drizzle-orm')
  const db = requireDb() as { select: Function }
  const rows = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1)
  const row = rows[0]
  if (!row) throw new Error(`conversation not found: ${id}`)
  return row as Conversation
}

export async function sendText(_input: unknown): Promise<unknown> {
  throw new Error('not-implemented-in-phase-2: inbox/conversations.sendText — use messages.appendTextMessage')
}

export async function sendCard(_input: unknown): Promise<unknown> {
  throw new Error('not-implemented-in-phase-2: inbox/conversations.sendCard — use messages.appendCardMessage')
}

export async function sendImage(_input: unknown): Promise<unknown> {
  throw new Error('not-implemented-in-phase-2: inbox/conversations.sendImage')
}

export async function resolve(_conversationId: string, _reason: string, _by: unknown): Promise<void> {
  throw new Error('not-implemented-in-phase-2: inbox/conversations.resolve')
}

export async function reassign(_conversationId: string, _to: unknown, _note?: string): Promise<void> {
  throw new Error('not-implemented-in-phase-2: inbox/conversations.reassign')
}

export async function hold(_conversationId: string, _reason: string): Promise<void> {
  throw new Error('not-implemented-in-phase-2: inbox/conversations.hold')
}

export async function reopen(_conversationId: string): Promise<void> {
  throw new Error('not-implemented-in-phase-2: inbox/conversations.reopen')
}

export async function beginCompaction(
  _conversationId: string,
  _summary: string,
): Promise<{ childConversationId: string }> {
  throw new Error('not-implemented-in-phase-2: inbox/conversations.beginCompaction')
}

export async function list(tenantId: string, opts?: { status?: string[] }): Promise<Conversation[]> {
  const { conversations } = await import('@modules/inbox/schema')
  const { eq, inArray, and, desc } = await import('drizzle-orm')
  const db = requireDb() as { select: Function }

  const whereClause = opts?.status?.length
    ? and(eq(conversations.tenantId, tenantId), inArray(conversations.status, opts.status))
    : eq(conversations.tenantId, tenantId)

  const rows = (await db
    .select()
    .from(conversations)
    .where(whereClause)
    .orderBy(desc(conversations.lastMessageAt))
    .limit(100)) as unknown[]

  return rows as Conversation[]
}
