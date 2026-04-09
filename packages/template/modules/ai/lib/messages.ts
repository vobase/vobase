import type { RealtimeService, VobaseDb } from '@vobase/core';
import { eq, sql } from 'drizzle-orm';

import { interactions, messages } from '../schema';
import type {
  ContentType,
  MessageType,
  ResolutionStatus,
  SenderType,
} from './message-types';

// ─── Insert Message ────────────────────────────────────────────────

interface InsertMessageInput {
  interactionId: string;
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
  replyToMessageId?: string | null;
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
      interactionId: input.interactionId,
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
    })
    .returning();

  // Update denormalized fields on the interaction
  await updateInteractionDenormalized(db, input.interactionId, message);

  // SSE notify
  await realtime
    .notify({
      table: 'interactions-messages',
      id: input.interactionId,
      action: 'insert',
    })
    .catch(() => {});
  await realtime
    .notify({
      table: 'interactions',
      id: input.interactionId,
      action: 'update',
    })
    .catch(() => {});

  return message;
}

// ─── Update Interaction Denormalized Fields ─────────────────────────

const HUMAN_MODES = ['human', 'supervised', 'held'];

async function updateInteractionDenormalized(
  db: VobaseDb,
  interactionId: string,
  message: typeof messages.$inferSelect,
): Promise<void> {
  // Activity messages and private notes only update lastActivityAt — they
  // should not overwrite the interaction list preview with event type
  // strings or internal staff notes
  if (message.messageType === 'activity' || message.private) {
    await db
      .update(interactions)
      .set({ lastActivityAt: message.createdAt })
      .where(eq(interactions.id, interactionId));
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
      .select({ mode: interactions.mode })
      .from(interactions)
      .where(eq(interactions.id, interactionId));

    if (conv && HUMAN_MODES.includes(conv.mode)) {
      await db
        .update(interactions)
        .set({
          ...updates,
          unreadCount: sql`unread_count + 1`,
        })
        .where(eq(interactions.id, interactionId));
      return;
    }
  }

  await db
    .update(interactions)
    .set(updates)
    .where(eq(interactions.id, interactionId));
}

// ─── Create Activity Message ───────────────────────────────────────

interface CreateActivityMessageInput {
  interactionId: string;
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
    interactionId: input.interactionId,
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
      .notify({ table: 'interactions-attention', action: 'insert' })
      .catch(() => {});
  }
  await realtime
    .notify({ table: 'interactions-dashboard', action: 'update' })
    .catch(() => {});

  return message;
}
