import type { ReactionEvent, RealtimeService, StatusUpdateEvent, VobaseDb } from '@vobase/core'
import { logger, shouldUpdateStatus } from '@vobase/core'
import { eq, sql } from 'drizzle-orm'

import { automationExecutions, automationRecipients, broadcastRecipients, broadcasts, messages } from '../schema'
import { getModuleDeps } from './deps'
import { insertMessage } from './messages'

export async function handleStatusUpdate(event: StatusUpdateEvent): Promise<void> {
  const { db, realtime } = getModuleDeps()

  const [message] = await db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      status: messages.status,
    })
    .from(messages)
    .where(eq(messages.externalMessageId, event.messageId))

  if (!message) {
    // Layer 2: check broadcast recipients (messages wins if same externalMessageId exists in multiple tables)
    const broadcastHandled = await handleBroadcastStatusUpdate(db, realtime, event)
    if (broadcastHandled) return
    // Layer 3: check automation recipients
    const automationHandled = await handleAutomationStatusUpdate(db, realtime, event)
    if (!automationHandled) {
      logger.warn('[messaging] status_update: message not found', {
        externalMessageId: event.messageId,
        status: event.status,
      })
    }
    return
  }

  // Only advance status — never go backwards (failed is always accepted)
  if (!shouldUpdateStatus(message.status, event.status)) {
    logger.info('[messaging] status_update: skipping out-of-order update', {
      externalMessageId: event.messageId,
      current: message.status,
      incoming: event.status,
    })
    return
  }

  await db.update(messages).set({ status: event.status }).where(eq(messages.id, message.id))

  // Insert system activity if the message was deleted on the sender's device
  if (event.metadata?.deleted === true) {
    await insertMessage(db, realtime, {
      conversationId: message.conversationId,
      messageType: 'activity',
      contentType: 'system',
      content: 'Message was deleted',
      contentData: {
        eventType: 'message_deleted',
        externalMessageId: event.messageId,
      },
      senderId: 'system',
      senderType: 'system',
    }).catch(() => {})
  }

  // Log delivery errors reported alongside the status update
  if (event.metadata?.errors) {
    logger.warn('[messaging] status_update: delivery errors reported', {
      externalMessageId: event.messageId,
      messageId: message.id,
      errors: event.metadata.errors,
    })
  }

  await realtime
    .notify({
      table: 'conversations-messages',
      id: message.conversationId,
      action: 'update',
    })
    .catch(() => {})

  logger.info('[messaging] status_update', {
    messageId: message.id,
    externalMessageId: event.messageId,
    status: event.status,
  })
}

export async function handleReaction(event: ReactionEvent): Promise<void> {
  const { db, realtime } = getModuleDeps()

  const [message] = await db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      contentData: messages.contentData,
    })
    .from(messages)
    .where(eq(messages.externalMessageId, event.messageId))

  if (!message) {
    logger.warn('[messaging] reaction: message not found', {
      externalMessageId: event.messageId,
    })
    return
  }

  const currentData = (message.contentData ?? {}) as Record<string, unknown>
  const existing = (currentData.reactions ?? []) as Array<Record<string, unknown>>

  // Dedup by from — remove any prior reaction from this sender, then re-add unless removing
  const filtered = existing.filter((r) => r.from !== event.from)
  const updatedReactions =
    event.action === 'remove'
      ? filtered
      : [
          ...filtered,
          {
            from: event.from,
            emoji: event.emoji,
            action: event.action ?? 'add',
            timestamp: event.timestamp,
          },
        ]

  await db
    .update(messages)
    .set({ contentData: { ...currentData, reactions: updatedReactions } })
    .where(eq(messages.id, message.id))

  await realtime
    .notify({
      table: 'conversations-messages',
      id: message.conversationId,
      action: 'update',
    })
    .catch(() => {})

  logger.info('[messaging] reaction', {
    messageId: message.id,
    from: event.from,
    emoji: event.emoji,
    action: event.action,
  })
}

// ─── Broadcast Status Fallback ────────────────────────────────────

// Union of all delivery statuses across messages, broadcastRecipients, and automationRecipients tables.
export type DeliveryStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'skipped'
  | 'replied'
  | 'chaser_paused'

const STATUS_ORDER: Record<DeliveryStatus, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
  skipped: 4, // terminal non-delivery — same weight as failed
  replied: 3, // engagement outcome — same weight as read
  chaser_paused: 1, // mid-progress pause — same weight as sent
}

async function handleBroadcastStatusUpdate(
  db: VobaseDb,
  realtime: RealtimeService,
  event: StatusUpdateEvent,
): Promise<boolean> {
  const [recipient] = await db
    .select({
      id: broadcastRecipients.id,
      broadcastId: broadcastRecipients.broadcastId,
      status: broadcastRecipients.status,
    })
    .from(broadcastRecipients)
    .where(eq(broadcastRecipients.externalMessageId, event.messageId))
    .limit(1)

  if (!recipient) return false

  // Only advance status (never go backwards), except failed always accepted
  // as DeliveryStatus: status comes from DB as string; schema CHECK constraint guarantees valid values
  const currentOrder = STATUS_ORDER[recipient.status as DeliveryStatus] ?? -1
  const newOrder = STATUS_ORDER[event.status as DeliveryStatus] ?? -1
  if (event.status !== 'failed' && newOrder <= currentOrder) return true

  const now = new Date()
  const updates: Partial<typeof broadcastRecipients.$inferInsert> = {
    status: event.status,
  }
  if (event.status === 'delivered') updates.deliveredAt = now
  if (event.status === 'read') {
    updates.readAt = now
    if (!recipient.status || recipient.status === 'sent') {
      updates.deliveredAt = now
    }
  }

  await db.update(broadcastRecipients).set(updates).where(eq(broadcastRecipients.id, recipient.id))

  // Atomically increment broadcast counters
  if (event.status === 'delivered') {
    await db
      .update(broadcasts)
      .set({ deliveredCount: sql`${broadcasts.deliveredCount} + 1` })
      .where(eq(broadcasts.id, recipient.broadcastId))
  } else if (event.status === 'read') {
    // If skipping delivered → read, increment both counters
    const skippedDelivered = recipient.status === 'sent' || recipient.status === 'queued'
    await db
      .update(broadcasts)
      .set({
        readCount: sql`${broadcasts.readCount} + 1`,
        ...(skippedDelivered && {
          deliveredCount: sql`${broadcasts.deliveredCount} + 1`,
        }),
      })
      .where(eq(broadcasts.id, recipient.broadcastId))
  }

  await realtime
    .notify({
      table: 'broadcasts',
      id: recipient.broadcastId,
      action: 'update',
    })
    .catch(() => {})

  logger.info('[broadcast] status_update', {
    recipientId: recipient.id,
    broadcastId: recipient.broadcastId,
    externalMessageId: event.messageId,
    status: event.status,
  })

  return true
}

// ─── Automation Status Fallback ───────────────────────────────────

async function handleAutomationStatusUpdate(
  db: VobaseDb,
  realtime: RealtimeService,
  event: StatusUpdateEvent,
): Promise<boolean> {
  const [recipient] = await db
    .select({
      id: automationRecipients.id,
      executionId: automationRecipients.executionId,
      status: automationRecipients.status,
    })
    .from(automationRecipients)
    .where(eq(automationRecipients.externalMessageId, event.messageId))
    .limit(1)

  if (!recipient) return false

  // as DeliveryStatus: status comes from DB as string; schema CHECK constraint guarantees valid values
  const currentOrder = STATUS_ORDER[recipient.status as DeliveryStatus] ?? -1
  const newOrder = STATUS_ORDER[event.status as DeliveryStatus] ?? -1
  if (event.status !== 'failed' && newOrder <= currentOrder) return true

  const now = new Date()
  const updates: Partial<typeof automationRecipients.$inferInsert> = {
    status: event.status,
  }
  if (event.status === 'sent') updates.sentAt = now
  if (event.status === 'delivered') updates.deliveredAt = now
  if (event.status === 'read') {
    updates.readAt = now
    if (recipient.status === 'sent' || recipient.status === 'queued') {
      updates.deliveredAt = now
    }
  }

  await db.update(automationRecipients).set(updates).where(eq(automationRecipients.id, recipient.id))

  // Atomically increment execution counters — no read-modify-write
  const skippedDelivered = event.status === 'read' && (recipient.status === 'sent' || recipient.status === 'queued')

  if (event.status === 'sent') {
    await db
      .update(automationExecutions)
      .set({ sentCount: sql`${automationExecutions.sentCount} + 1` })
      .where(eq(automationExecutions.id, recipient.executionId))
  } else if (event.status === 'delivered') {
    await db
      .update(automationExecutions)
      .set({ deliveredCount: sql`${automationExecutions.deliveredCount} + 1` })
      .where(eq(automationExecutions.id, recipient.executionId))
  } else if (event.status === 'read') {
    await db
      .update(automationExecutions)
      .set({
        readCount: sql`${automationExecutions.readCount} + 1`,
        ...(skippedDelivered && {
          deliveredCount: sql`${automationExecutions.deliveredCount} + 1`,
        }),
      })
      .where(eq(automationExecutions.id, recipient.executionId))
  } else if (event.status === 'failed') {
    await db
      .update(automationExecutions)
      .set({ failedCount: sql`${automationExecutions.failedCount} + 1` })
      .where(eq(automationExecutions.id, recipient.executionId))
  }

  await realtime
    .notify({
      table: 'automation-executions',
      id: recipient.executionId,
      action: 'update',
    })
    .catch(() => {})

  logger.info('[automation] status_update', {
    recipientId: recipient.id,
    executionId: recipient.executionId,
    externalMessageId: event.messageId,
    status: event.status,
  })

  return true
}
