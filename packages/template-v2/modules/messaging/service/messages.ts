/**
 * Sole write path for messaging.messages (one-write-path invariant).
 * Every message append atomically journals a tool_execution_end event so the
 * messages table and conversation_events stay in sync.
 *
 * Factory-DI service. `createMessagesService({ db })` returns the
 * bound API; free-function wrappers route through the installed instance.
 * The journaled transaction is intrinsic to this file (it invokes
 * `journal.append(event, tx)` unconditionally), so it's whitelisted in
 * check:shape rule 2 alongside `modules/agents/service/journal.ts`.
 */
import type { OutboundToolName } from '@server/contracts/channel-event'
import type { Message } from '../schema'

type TxShape = { insert: InsertFn } & {
  select?: () => { from: (t: unknown) => { where: (c: unknown) => { limit: (n: number) => Promise<unknown[]> } } }
}
type DbHandle = {
  transaction: <T>(fn: (tx: TxShape) => Promise<T>) => Promise<T>
  select?: () => { from: (t: unknown) => { where: (c: unknown) => { limit: (n: number) => Promise<unknown[]> } } }
  insert?: InsertFn
}

export interface AppendTextMessageInput {
  conversationId: string
  organizationId: string
  agentId: string
  wakeId: string
  turnIndex: number
  toolCallId: string
  text: string
  replyToMessageId?: string
}

export interface AppendCardMessageInput {
  conversationId: string
  organizationId: string
  agentId: string
  wakeId: string
  turnIndex: number
  toolCallId: string
  card: unknown
  replyToMessageId?: string
}

export interface AppendMediaMessageInput {
  conversationId: string
  organizationId: string
  agentId: string
  wakeId: string
  turnIndex: number
  toolCallId: string
  driveFileId: string
  caption?: string
}

export interface AppendStaffTextMessageInput {
  conversationId: string
  organizationId: string
  staffUserId: string
  body: string
}

export interface AppendCardReplyInput {
  parentMessageId: string
  buttonId: string
  buttonValue: string
  buttonLabel?: string
}

type InsertFn = (t: unknown) => { values: (v: unknown) => { returning: () => Promise<unknown[]> } }

async function insertMessageRow(
  txDb: { insert: InsertFn },
  row: {
    conversationId: string
    organizationId: string
    role: string
    kind: string
    content: unknown
    parentMessageId?: string | null
  },
): Promise<Message> {
  const { messages } = await import('@modules/messaging/schema')
  const rows = await txDb
    .insert(messages)
    .values({
      conversationId: row.conversationId,
      organizationId: row.organizationId,
      role: row.role,
      kind: row.kind,
      content: row.content,
      parentMessageId: row.parentMessageId ?? null,
    })
    .returning()
  const result = rows[0]
  if (!result) throw new Error('messaging/messages: insert returned no rows')
  return result as Message
}

async function journalToolEnd(
  tx: unknown,
  input: {
    conversationId: string
    organizationId: string
    wakeId: string
    turnIndex: number
    toolCallId: string
    toolName: string
    messageId: string
  },
): Promise<void> {
  const { journalAppend: append } = await import('@vobase/core')
  await append(
    {
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      wakeId: input.wakeId,
      turnIndex: input.turnIndex,
      event: {
        type: 'tool_execution_end',
        ts: new Date(),
        wakeId: input.wakeId,
        conversationId: input.conversationId,
        organizationId: input.organizationId,
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

async function journalChannelInbound(
  tx: unknown,
  input: { conversationId: string; organizationId: string; messageId: string; turnIndex: number },
): Promise<void> {
  const { journalAppend: append } = await import('@vobase/core')
  const wakeId = `card_reply:${input.messageId}`
  await append(
    {
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      wakeId,
      turnIndex: input.turnIndex,
      event: {
        type: 'channel_inbound',
        ts: new Date(),
        wakeId,
        conversationId: input.conversationId,
        organizationId: input.organizationId,
        turnIndex: input.turnIndex,
        channelType: 'web',
        externalMessageId: input.messageId,
      },
    },
    tx,
  )
}

type ListableDb = {
  select: () => {
    from: (t: unknown) => {
      where: (c: unknown) => { orderBy: (col: unknown) => { limit: (n: number) => Promise<unknown[]> } }
    }
  }
}

export interface MessagesService {
  appendTextMessage(input: AppendTextMessageInput): Promise<Message>
  appendCardMessage(input: AppendCardMessageInput): Promise<Message>
  appendMediaMessage(input: AppendMediaMessageInput): Promise<Message>
  appendStaffTextMessage(input: AppendStaffTextMessageInput): Promise<Message>
  appendCardReplyMessage(input: AppendCardReplyInput): Promise<Message>
  list(conversationId: string, opts?: { limit?: number; since?: Date }): Promise<Message[]>
}

export interface MessagesServiceDeps {
  db: unknown
}

export function createMessagesService(deps: MessagesServiceDeps): MessagesService {
  const db = deps.db as DbHandle

  interface AppendAgentMessageCtx {
    conversationId: string
    organizationId: string
    wakeId: string
    turnIndex: number
    toolCallId: string
  }

  async function appendAgentMessage(
    ctx: AppendAgentMessageCtx,
    kind: 'text' | 'card' | 'image',
    content: unknown,
    toolName: OutboundToolName,
    replyToMessageId?: string,
  ): Promise<Message> {
    return db.transaction(async (tx) => {
      const msg = await insertMessageRow(tx as { insert: InsertFn }, {
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        role: 'agent',
        kind,
        content,
        parentMessageId: replyToMessageId,
      })
      await journalToolEnd(tx, {
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        wakeId: ctx.wakeId,
        turnIndex: ctx.turnIndex,
        toolCallId: ctx.toolCallId,
        toolName,
        messageId: msg.id,
      })
      return msg
    })
  }

  async function appendTextMessage(input: AppendTextMessageInput): Promise<Message> {
    return appendAgentMessage(input, 'text', { text: input.text }, 'reply', input.replyToMessageId)
  }

  async function appendCardMessage(input: AppendCardMessageInput): Promise<Message> {
    return appendAgentMessage(input, 'card', { card: input.card }, 'send_card', input.replyToMessageId)
  }

  async function appendMediaMessage(input: AppendMediaMessageInput): Promise<Message> {
    return appendAgentMessage(
      input,
      'image',
      { driveFileId: input.driveFileId, caption: input.caption ?? null },
      'send_file',
    )
  }

  async function appendStaffTextMessage(input: AppendStaffTextMessageInput): Promise<Message> {
    const toolCallId = `staff_reply:${Date.now()}`
    const wakeId = `staff_reply:${input.staffUserId}`
    return db.transaction(async (tx) => {
      const msg = await insertMessageRow(tx as { insert: InsertFn }, {
        conversationId: input.conversationId,
        organizationId: input.organizationId,
        role: 'staff',
        kind: 'text',
        content: { text: input.body },
      })
      await journalToolEnd(tx, {
        conversationId: input.conversationId,
        organizationId: input.organizationId,
        wakeId,
        turnIndex: 0,
        toolCallId,
        toolName: 'staff_reply',
        messageId: msg.id,
      })
      return msg
    })
  }

  async function appendCardReplyMessage(input: AppendCardReplyInput): Promise<Message> {
    return db.transaction(async (tx) => {
      const { messages } = await import('@modules/messaging/schema')
      const { eq } = await import('drizzle-orm')
      const txDb = tx as {
        select: () => {
          from: (t: unknown) => { where: (c: unknown) => { limit: (n: number) => Promise<unknown[]> } }
        }
      } & { insert: InsertFn }
      const parentRows = await txDb.select().from(messages).where(eq(messages.id, input.parentMessageId)).limit(1)
      const parent = parentRows[0] as Message | undefined
      if (!parent) throw new Error(`messaging/messages: parent message ${input.parentMessageId} not found`)

      const msg = await insertMessageRow(txDb, {
        conversationId: parent.conversationId,
        organizationId: parent.organizationId,
        role: 'customer',
        kind: 'card_reply',
        content: {
          buttonId: input.buttonId,
          buttonValue: input.buttonValue,
          buttonLabel: input.buttonLabel ?? null,
        },
        parentMessageId: input.parentMessageId,
      })
      const { journalGetLatestTurnIndex: getLatestTurnIndex } = await import('@vobase/core')
      const turnIndex = await getLatestTurnIndex(parent.conversationId, tx)
      await journalChannelInbound(tx, {
        conversationId: parent.conversationId,
        organizationId: parent.organizationId,
        messageId: msg.id,
        turnIndex,
      })
      return msg
    })
  }

  async function list(conversationId: string, opts?: { limit?: number; since?: Date }): Promise<Message[]> {
    const { messages } = await import('@modules/messaging/schema')
    const { eq, and, gt, asc, desc } = await import('drizzle-orm')
    const listDb = db as unknown as ListableDb

    const whereClause = opts?.since
      ? and(eq(messages.conversationId, conversationId), gt(messages.createdAt, opts.since))
      : eq(messages.conversationId, conversationId)

    if (opts?.since) {
      const rows = await listDb
        .select()
        .from(messages)
        .where(whereClause)
        .orderBy(asc(messages.createdAt))
        .limit(opts.limit ?? 50)
      return rows as Message[]
    }

    const rows = await listDb
      .select()
      .from(messages)
      .where(whereClause)
      .orderBy(desc(messages.createdAt))
      .limit(opts?.limit ?? 50)

    return (rows as Message[]).reverse()
  }

  return {
    appendTextMessage,
    appendCardMessage,
    appendMediaMessage,
    appendStaffTextMessage,
    appendCardReplyMessage,
    list,
  }
}

let _currentMessagesService: MessagesService | null = null

export function installMessagesService(svc: MessagesService): void {
  _currentMessagesService = svc
}

export function __resetMessagesServiceForTests(): void {
  _currentMessagesService = null
}

function currentMessages(): MessagesService {
  if (!_currentMessagesService) {
    throw new Error('messaging/messages: service not installed — call installMessagesService()')
  }
  return _currentMessagesService
}

export async function appendTextMessage(input: AppendTextMessageInput): Promise<Message> {
  return currentMessages().appendTextMessage(input)
}
export async function appendCardMessage(input: AppendCardMessageInput): Promise<Message> {
  return currentMessages().appendCardMessage(input)
}
export async function appendMediaMessage(input: AppendMediaMessageInput): Promise<Message> {
  return currentMessages().appendMediaMessage(input)
}
export async function appendStaffTextMessage(input: AppendStaffTextMessageInput): Promise<Message> {
  return currentMessages().appendStaffTextMessage(input)
}
export async function appendCardReplyMessage(input: AppendCardReplyInput): Promise<Message> {
  return currentMessages().appendCardReplyMessage(input)
}
export async function list(conversationId: string, opts?: { limit?: number; since?: Date }): Promise<Message[]> {
  return currentMessages().list(conversationId, opts)
}
