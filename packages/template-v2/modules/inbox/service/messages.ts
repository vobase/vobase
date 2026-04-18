/**
 * REAL Phase 2 — sole write path for inbox.messages (spec §2.3 one-write-path invariant).
 * Every message append also atomically journals a tool_execution_end event so the
 * messages table and conversation_events are never out of sync.
 */
import type { Message } from '@server/contracts/domain-types'

let _db: unknown = null

export function setDb(db: unknown): void {
  _db = db
}

function requireDb() {
  if (!_db) throw new Error('inbox/messages: db not initialised — call setDb() in module init')
  return _db as { transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T> }
}

export interface AppendTextMessageInput {
  conversationId: string
  tenantId: string
  agentId: string
  wakeId: string
  turnIndex: number
  toolCallId: string
  text: string
  replyToMessageId?: string
}

export interface AppendCardMessageInput {
  conversationId: string
  tenantId: string
  agentId: string
  wakeId: string
  turnIndex: number
  toolCallId: string
  card: unknown
  replyToMessageId?: string
}

export interface AppendMediaMessageInput {
  conversationId: string
  tenantId: string
  agentId: string
  wakeId: string
  turnIndex: number
  toolCallId: string
  driveFileId: string
  caption?: string
}

type InsertFn = (t: unknown) => { values: (v: unknown) => { returning: () => Promise<unknown[]> } }

async function insertMessageRow(
  txDb: { insert: InsertFn },
  row: {
    conversationId: string
    tenantId: string
    role: string
    kind: string
    content: unknown
    parentMessageId?: string | null
  },
): Promise<Message> {
  const { messages } = await import('@modules/inbox/schema')
  const rows = await txDb
    .insert(messages)
    .values({
      conversationId: row.conversationId,
      tenantId: row.tenantId,
      role: row.role,
      kind: row.kind,
      content: row.content,
      parentMessageId: row.parentMessageId ?? null,
    })
    .returning()
  const result = rows[0]
  if (!result) throw new Error('inbox/messages: insert returned no rows')
  return result as Message
}

async function journalToolEnd(
  tx: unknown,
  input: {
    conversationId: string
    tenantId: string
    wakeId: string
    turnIndex: number
    toolCallId: string
    toolName: string
    messageId: string
  },
): Promise<void> {
  const { append } = await import('@modules/agents/service/journal')
  await append(
    {
      conversationId: input.conversationId,
      tenantId: input.tenantId,
      wakeId: input.wakeId,
      turnIndex: input.turnIndex,
      event: {
        type: 'tool_execution_end',
        ts: new Date(),
        wakeId: input.wakeId,
        conversationId: input.conversationId,
        tenantId: input.tenantId,
        turnIndex: input.turnIndex,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        result: { messageId: input.messageId },
        isError: false,
        latencyMs: 0,
      },
    },
    tx,
  )
}

export async function appendTextMessage(input: AppendTextMessageInput): Promise<Message> {
  const db = requireDb()
  return db.transaction(async (tx) => {
    const msg = await insertMessageRow(tx as { insert: InsertFn }, {
      conversationId: input.conversationId,
      tenantId: input.tenantId,
      role: 'agent',
      kind: 'text',
      content: { text: input.text },
      parentMessageId: input.replyToMessageId,
    })
    await journalToolEnd(tx, {
      conversationId: input.conversationId,
      tenantId: input.tenantId,
      wakeId: input.wakeId,
      turnIndex: input.turnIndex,
      toolCallId: input.toolCallId,
      toolName: 'reply',
      messageId: msg.id,
    })
    return msg
  })
}

export async function appendCardMessage(input: AppendCardMessageInput): Promise<Message> {
  const db = requireDb()
  return db.transaction(async (tx) => {
    const msg = await insertMessageRow(tx as { insert: InsertFn }, {
      conversationId: input.conversationId,
      tenantId: input.tenantId,
      role: 'agent',
      kind: 'card',
      content: { card: input.card },
      parentMessageId: input.replyToMessageId,
    })
    await journalToolEnd(tx, {
      conversationId: input.conversationId,
      tenantId: input.tenantId,
      wakeId: input.wakeId,
      turnIndex: input.turnIndex,
      toolCallId: input.toolCallId,
      toolName: 'send_card',
      messageId: msg.id,
    })
    return msg
  })
}

export async function appendMediaMessage(input: AppendMediaMessageInput): Promise<Message> {
  const db = requireDb()
  return db.transaction(async (tx) => {
    const msg = await insertMessageRow(tx as { insert: InsertFn }, {
      conversationId: input.conversationId,
      tenantId: input.tenantId,
      role: 'agent',
      kind: 'image',
      content: { driveFileId: input.driveFileId, caption: input.caption ?? null },
    })
    await journalToolEnd(tx, {
      conversationId: input.conversationId,
      tenantId: input.tenantId,
      wakeId: input.wakeId,
      turnIndex: input.turnIndex,
      toolCallId: input.toolCallId,
      toolName: 'send_file',
      messageId: msg.id,
    })
    return msg
  })
}

export async function list(conversationId: string, opts?: { limit?: number; since?: Date }): Promise<Message[]> {
  const { messages } = await import('@modules/inbox/schema')
  const { eq, and, gt, asc, desc } = await import('drizzle-orm')
  const db = requireDb() as unknown as { select: Function }

  const whereClause = opts?.since
    ? and(eq(messages.conversationId, conversationId), gt(messages.createdAt, opts.since))
    : eq(messages.conversationId, conversationId)

  // `since` paginates forward from a cursor — take the next N oldest-first.
  // Default is a conversation head fetch — take the newest N, then reverse so
  // the UI renders chronologically without a second sort.
  if (opts?.since) {
    const rows = (await db
      .select()
      .from(messages)
      .where(whereClause)
      .orderBy(asc(messages.createdAt))
      .limit(opts.limit ?? 50)) as unknown[]
    return rows as Message[]
  }

  const rows = (await db
    .select()
    .from(messages)
    .where(whereClause)
    .orderBy(desc(messages.createdAt))
    .limit(opts?.limit ?? 50)) as unknown[]

  return (rows as Message[]).reverse()
}
