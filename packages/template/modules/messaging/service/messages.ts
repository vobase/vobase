/**
 * Sole write path for messaging.messages (one-write-path invariant).
 * Every message append atomically journals a tool_execution_end event so the
 * messages table and conversation_events stay in sync.
 *
 * Factory-DI service. `createMessagesService({ db })` returns the
 * bound API; free-function wrappers route through the installed instance.
 * The journaled transaction is intrinsic to this file (it invokes
 * `journal.append(event, tx)` unconditionally), so it's whitelisted in
 * check:shape rule 1 alongside the rest of `modules/messaging/service/**`.
 */

import { messages } from '@modules/messaging/schema'
import { journalAppend as append, journalGetLatestTurnIndex as getLatestTurnIndex } from '@vobase/core'
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm'

import type { OutboundToolName } from '~/runtime/channel-events'
import type { Message } from '../schema'
import { advanceMessageStatus, type MessageStatus } from '../state'
import type { MessageMetadata } from './echo-metadata'
import { extractEchoMetadata } from './echo-metadata'

type UpdateFn = (t: unknown) => {
  set: (v: unknown) => { where: (c: unknown) => { returning: () => Promise<unknown[]> } }
}
type TxShape = { insert: InsertFn; update?: UpdateFn } & {
  select?: () => { from: (t: unknown) => { where: (c: unknown) => { limit: (n: number) => Promise<unknown[]> } } }
}
type DbHandle = {
  transaction: <T>(fn: (tx: TxShape) => Promise<T>) => Promise<T>
  select?: () => { from: (t: unknown) => { where: (c: unknown) => { limit: (n: number) => Promise<unknown[]> } } }
  update?: UpdateFn
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
  /**
   * Optional pre-resolved drive attachment refs. Bytes have already been
   * ingested by the caller (`staff-reply.ts`); this writer only persists
   * the denormalized refs onto the message row.
   */
  attachments?: import('@modules/drive/service/types').MessageAttachmentRef[]
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
    attachments?: import('@modules/drive/service/types').MessageAttachmentRef[]
  },
): Promise<Message> {
  const rows = await txDb
    .insert(messages)
    .values({
      conversationId: row.conversationId,
      organizationId: row.organizationId,
      role: row.role,
      kind: row.kind,
      content: row.content,
      parentMessageId: row.parentMessageId ?? null,
      attachments: row.attachments ?? [],
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

export interface UpdateDeliveryStatusInput {
  /** The channel-external message ID (wamid) from the status webhook. */
  channelExternalId: string
  status: MessageStatus
  errorCode?: string
  errorMessage?: string
}

export interface MessagesService {
  appendTextMessage(input: AppendTextMessageInput): Promise<Message>
  appendCardMessage(input: AppendCardMessageInput): Promise<Message>
  appendMediaMessage(input: AppendMediaMessageInput): Promise<Message>
  appendStaffTextMessage(input: AppendStaffTextMessageInput): Promise<Message>
  appendCardReplyMessage(input: AppendCardReplyInput): Promise<Message>
  list(conversationId: string, opts?: { limit?: number; since?: Date }): Promise<Message[]>
  updateDeliveryStatus(input: UpdateDeliveryStatusInput): Promise<void>
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

  // biome-ignore lint/suspicious/useAwait: contract requires async signature
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

  // biome-ignore lint/suspicious/useAwait: contract requires async signature
  async function appendTextMessage(input: AppendTextMessageInput): Promise<Message> {
    return appendAgentMessage(input, 'text', { text: input.text }, 'reply', input.replyToMessageId)
  }

  // biome-ignore lint/suspicious/useAwait: contract requires async signature
  async function appendCardMessage(input: AppendCardMessageInput): Promise<Message> {
    return appendAgentMessage(input, 'card', { card: input.card }, 'send_card', input.replyToMessageId)
  }

  // biome-ignore lint/suspicious/useAwait: contract requires async signature
  async function appendMediaMessage(input: AppendMediaMessageInput): Promise<Message> {
    return appendAgentMessage(
      input,
      'image',
      { driveFileId: input.driveFileId, caption: input.caption ?? null },
      'send_file',
    )
  }

  // biome-ignore lint/suspicious/useAwait: contract requires async signature
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
        attachments: input.attachments,
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

  // biome-ignore lint/suspicious/useAwait: contract requires async signature
  async function appendCardReplyMessage(input: AppendCardReplyInput): Promise<Message> {
    return db.transaction(async (tx) => {
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

  async function updateDeliveryStatus(input: UpdateDeliveryStatusInput): Promise<void> {
    await db.transaction(async (tx) => {
      const txDb = tx as {
        select: () => { from: (t: unknown) => { where: (c: unknown) => { limit: (n: number) => Promise<unknown[]> } } }
        update: UpdateFn
      }
      const rows = await txDb
        .select()
        .from(messages)
        .where(eq(messages.channelExternalId, input.channelExternalId))
        .limit(1)
      const existing = rows[0] as Message | undefined
      if (!existing) return

      const currentStatus = (existing.status ?? 'queued') as MessageStatus
      const nextStatus = advanceMessageStatus(currentStatus, input.status)

      const existingMeta = extractEchoMetadata(existing.metadata as Record<string, unknown> | undefined)
      const statusEntry: Record<string, unknown> = { status: nextStatus, ts: new Date().toISOString() }
      if (input.errorCode) statusEntry.errorCode = input.errorCode
      if (input.errorMessage) statusEntry.errorMessage = input.errorMessage

      const updatedMeta: MessageMetadata & { statusHistory?: unknown[] } = {
        ...existingMeta,
        statusHistory: [
          ...(((existing.metadata as Record<string, unknown>)?.statusHistory as unknown[]) ?? []),
          statusEntry,
        ],
      }

      await txDb
        .update(messages)
        .set({ status: nextStatus, metadata: sql`${JSON.stringify(updatedMeta)}::jsonb` })
        .where(eq(messages.channelExternalId, input.channelExternalId))
        .returning()
    })
  }

  return {
    appendTextMessage,
    appendCardMessage,
    appendMediaMessage,
    appendStaffTextMessage,
    appendCardReplyMessage,
    list,
    updateDeliveryStatus,
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

// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function appendTextMessage(input: AppendTextMessageInput): Promise<Message> {
  return currentMessages().appendTextMessage(input)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function appendCardMessage(input: AppendCardMessageInput): Promise<Message> {
  return currentMessages().appendCardMessage(input)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function appendMediaMessage(input: AppendMediaMessageInput): Promise<Message> {
  return currentMessages().appendMediaMessage(input)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function appendStaffTextMessage(input: AppendStaffTextMessageInput): Promise<Message> {
  return currentMessages().appendStaffTextMessage(input)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function appendCardReplyMessage(input: AppendCardReplyInput): Promise<Message> {
  return currentMessages().appendCardReplyMessage(input)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function list(conversationId: string, opts?: { limit?: number; since?: Date }): Promise<Message[]> {
  return currentMessages().list(conversationId, opts)
}

export async function updateDeliveryStatus(input: UpdateDeliveryStatusInput): Promise<void> {
  return currentMessages().updateDeliveryStatus(input)
}
