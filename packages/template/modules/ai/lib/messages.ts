import type { RealtimeService, VobaseDb } from '@vobase/core';
import { eq, sql } from 'drizzle-orm';

import { conversations, messages } from '../schema';
import type {
  ContentType,
  MessageType,
  ResolutionStatus,
  SenderType,
} from './message-types';

// ─── Insert Message ────────────────────────────────────────────────

interface InsertMessageInput {
  conversationId: string;
  messageType: MessageType;
  contentType: ContentType;
  content: string;
  contentData?: Record<string, unknown>;
  status?: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | null;
  failureReason?: string | null;
  senderId: string;
  senderType: SenderType;
  externalMessageId?: string | null;
  channelType?: string | null;
  private?: boolean;
  withdrawn?: boolean;
  resolutionStatus?: ResolutionStatus | null;
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
      resolutionStatus: input.resolutionStatus ?? null,
    })
    .returning();

  // Update denormalized fields on the conversation
  await updateConversationDenormalized(db, input.conversationId, message);

  // SSE notify
  await realtime
    .notify({
      table: 'conversations-messages',
      id: input.conversationId,
      action: 'insert',
    })
    .catch(() => {});
  await realtime
    .notify({
      table: 'conversations',
      id: input.conversationId,
      action: 'update',
    })
    .catch(() => {});

  return message;
}

// ─── Update Conversation Denormalized Fields ───────────────────────

const HUMAN_MODES = ['human', 'supervised', 'held'];

async function updateConversationDenormalized(
  db: VobaseDb,
  conversationId: string,
  message: typeof messages.$inferSelect,
): Promise<void> {
  // Activity messages and private notes only update lastActivityAt — they
  // should not overwrite the conversation list preview with event type
  // strings or internal staff notes
  if (message.messageType === 'activity' || message.private) {
    await db
      .update(conversations)
      .set({ lastActivityAt: message.createdAt })
      .where(eq(conversations.id, conversationId));
    return;
  }

  const updates: Record<string, unknown> = {
    lastMessageContent: message.content.slice(0, 200),
    lastMessageAt: message.createdAt,
    lastMessageType: message.messageType,
    lastActivityAt: message.createdAt,
  };

  // Increment unreadCount for inbound messages in human-handled modes
  if (message.messageType === 'incoming') {
    const [conv] = await db
      .select({ mode: conversations.mode })
      .from(conversations)
      .where(eq(conversations.id, conversationId));

    if (conv && HUMAN_MODES.includes(conv.mode)) {
      await db
        .update(conversations)
        .set({
          ...updates,
          unreadCount: sql`unread_count + 1`,
        })
        .where(eq(conversations.id, conversationId));
      return;
    }
  }

  await db
    .update(conversations)
    .set(updates)
    .where(eq(conversations.id, conversationId));
}

// ─── Create Activity Message ───────────────────────────────────────

interface CreateActivityMessageInput {
  conversationId: string;
  eventType: string;
  actor?: string;
  actorType?: SenderType;
  data?: Record<string, unknown>;
  resolutionStatus?: ResolutionStatus | null;
}

export async function createActivityMessage(
  db: VobaseDb,
  realtime: RealtimeService,
  input: CreateActivityMessageInput,
): Promise<typeof messages.$inferSelect> {
  const senderId = input.actor ?? 'system';
  const senderType = input.actorType ?? 'system';

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
  });

  // Additional SSE for attention/dashboard
  if (input.resolutionStatus === 'pending') {
    await realtime
      .notify({ table: 'conversations-attention', action: 'insert' })
      .catch(() => {});
  }
  await realtime
    .notify({ table: 'conversations-dashboard', action: 'update' })
    .catch(() => {});

  return message;
}
