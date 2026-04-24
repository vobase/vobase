import type { RealtimeService, VobaseDb } from '@vobase/core'

import { messages } from '../schema'
import type { ContentType, MessageType, ResolutionStatus, SenderType } from './message-types'

// ─── Insert Message ────────────────────────────────────────────────

interface InsertMessageInput {
  conversationId: string
  messageType: MessageType
  contentType: ContentType
  content: string
  contentData?: Record<string, unknown>
  status?: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | null
  failureReason?: string | null
  senderId: string
  senderType: SenderType
  externalMessageId?: string | null
  channelType?: string | null
  private?: boolean
  withdrawn?: boolean
  replyToMessageId?: string | null
  resolutionStatus?: ResolutionStatus | null
  mentions?: Array<{ targetId: string; targetType: 'user' | 'agent' }>
}

export async function insertMessage(
  db: VobaseDb,
  realtime: RealtimeService,
  input: InsertMessageInput,
): Promise<typeof messages.$inferSelect> {
  const [message] = await db
    .insert(messages)
    .values({
      conversationId: input.conversationId,
      messageType: input.messageType,
      contentType: input.contentType,
      content: input.content,
      contentData: input.contentData ?? {},
      status: input.status ?? null,
      failureReason: input.failureReason ?? null,
      senderId: input.senderId,
      senderType: input.senderType,
      externalMessageId: input.externalMessageId ?? null,
      channelType: input.channelType ?? null,
      private: input.private ?? false,
      withdrawn: input.withdrawn ?? false,
      replyToMessageId: input.replyToMessageId ?? null,
      resolutionStatus: input.resolutionStatus ?? null,
      mentions: input.mentions ?? [],
    })
    .returning()

  // SSE notify
  await realtime
    .notify({
      table: 'conversations-messages',
      id: input.conversationId,
      action: 'insert',
    })
    .catch(() => {})
  await realtime
    .notify({
      table: 'conversations',
      id: input.conversationId,
      action: 'update',
    })
    .catch(() => {})

  return message
}

// ─── Create Activity Message ───────────────────────────────────────

interface CreateActivityMessageInput {
  conversationId: string
  eventType: string
  actor?: string
  actorType?: SenderType
  data?: Record<string, unknown>
  resolutionStatus?: ResolutionStatus | null
}

export async function createActivityMessage(
  db: VobaseDb,
  realtime: RealtimeService,
  input: CreateActivityMessageInput,
): Promise<typeof messages.$inferSelect> {
  const senderId = input.actor ?? 'system'
  const senderType = input.actorType ?? 'system'

  const message = await insertMessage(db, realtime, {
    conversationId: input.conversationId,
    messageType: 'activity',
    contentType: 'system',
    content: input.eventType,
    contentData: {
      eventType: input.eventType,
      actor: input.actor,
      actorType: input.actorType,
      ...(input.data ?? {}),
    },
    senderId,
    senderType,
    resolutionStatus: input.resolutionStatus ?? null,
  })

  // Additional SSE for attention/dashboard
  if (input.resolutionStatus === 'pending') {
    await realtime.notify({ table: 'conversations-attention', action: 'insert' }).catch(() => {})
  }
  await realtime.notify({ table: 'conversations-dashboard', action: 'update' }).catch(() => {})

  return message
}
