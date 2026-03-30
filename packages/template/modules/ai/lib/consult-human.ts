import type {
  ChannelsService,
  MessageReceivedEvent,
  RealtimeService,
  Scheduler,
  VobaseDb,
} from '@vobase/core';
import { logger } from '@vobase/core';
import { and, eq, lt, ne, sql } from 'drizzle-orm';

import { consultations, contacts, conversations } from '../schema';
import { computeTab, emitActivityEvent } from './activity-events';
import { getChatState } from './chat-init';
import { updateLastSignal } from './last-signal';

interface ConsultDeps {
  db: VobaseDb;
  scheduler: Scheduler;
  channels: ChannelsService;
  realtime: RealtimeService;
}

interface RequestConsultationInput {
  conversationId: string;
  staffContactId: string;
  channelType: string;
  channelInstanceId?: string;
  reason: string;
  message: string;
}

export async function requestConsultation(
  deps: ConsultDeps,
  input: RequestConsultationInput,
): Promise<typeof consultations.$inferSelect> {
  const { db, channels } = deps;
  const start = Date.now();

  // Check no active (pending) consultation for this conversation
  const [existing] = await db
    .select()
    .from(consultations)
    .where(
      and(
        eq(consultations.conversationId, input.conversationId),
        eq(consultations.status, 'pending'),
      ),
    );

  if (existing) {
    return existing;
  }

  // Look up conversation for event context
  const [conversation] = await db
    .select({
      agentId: conversations.agentId,
      contactId: conversations.contactId,
      channelRoutingId: conversations.channelRoutingId,
      mode: conversations.mode,
    })
    .from(conversations)
    .where(eq(conversations.id, input.conversationId));

  // Insert consultation + emit escalation.created transactionally
  let escalationEventId: string | null = null;
  const consultation = await db.transaction(async (tx) => {
    const [record] = await tx
      .insert(consultations)
      .values({
        conversationId: input.conversationId,
        staffContactId: input.staffContactId,
        channelType: input.channelType,
        channelInstanceId: input.channelInstanceId ?? null,
        reason: input.reason,
        status: 'pending',
      })
      .returning();

    await tx
      .update(conversations)
      .set({ hasPendingEscalation: true })
      .where(eq(conversations.id, input.conversationId));

    escalationEventId = await emitActivityEvent(
      deps.db,
      deps.realtime,
      {
        type: 'escalation.created',
        agentId: conversation?.agentId,
        source: 'agent',
        contactId: conversation?.contactId,
        conversationId: input.conversationId,
        channelRoutingId: conversation?.channelRoutingId,
        channelType: input.channelType,
        data: { reason: input.reason, staffContactId: input.staffContactId },
        resolutionStatus: 'pending',
      },
      tx as unknown as VobaseDb,
    );

    return record;
  });

  // Update last-signal pointer for escalation
  if (escalationEventId) {
    await updateLastSignal(
      db,
      input.conversationId,
      'activity',
      escalationEventId,
    );
  }

  // Notify inbox — conversation moved to attention tab (now has pending escalation)
  await deps.realtime.notify({
    table: 'conversations',
    id: input.conversationId,
    tab: 'attention',
    prevTab: computeTab(conversation?.mode ?? null, 'active', false),
  });

  // Look up staff contact for delivery address
  const [staffContact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, input.staffContactId));

  if (!staffContact) {
    logger.warn('[conversations] Staff contact not found for consultation', {
      staffContactId: input.staffContactId,
    });
    return consultation;
  }

  // Send notification to staff via the appropriate channel
  const notificationText = `[Consultation Request]\n\nReason: ${input.reason}\n\n${input.message}\n\nReply to this message to respond.`;

  try {
    let sendResult: { success: boolean; error?: string } | undefined;

    if (input.channelType === 'whatsapp' && staffContact.phone) {
      sendResult = await channels.whatsapp.send({
        to: staffContact.phone,
        text: notificationText,
      });
    } else if (input.channelType === 'email' && staffContact.email) {
      sendResult = await channels.email.send({
        to: staffContact.email,
        subject: `Consultation: ${input.reason}`,
        html: `<p>${notificationText.replace(/\n/g, '<br>')}</p>`,
      });
    }

    // Check send result — mark consultation if notification failed (H7)
    if (sendResult && !sendResult.success) {
      logger.error('[conversations] Consultation notification send failed', {
        consultationId: consultation.id,
        error: sendResult.error,
      });
      await db
        .update(consultations)
        .set({ status: 'notification_failed' })
        .where(eq(consultations.id, consultation.id));
    }
  } catch (err) {
    logger.error('[conversations] Failed to send consultation notification', {
      consultationId: consultation.id,
      error: err,
    });
    await db
      .update(consultations)
      .set({ status: 'notification_failed' })
      .where(eq(consultations.id, consultation.id));
  }

  logger.info('[conversations] consultation_request', {
    consultationId: consultation.id,
    conversationId: input.conversationId,
    channelType: input.channelType,
    durationMs: Date.now() - start,
    outcome: 'requested',
  });

  return consultation;
}

export async function handleStaffReply(
  deps: ConsultDeps,
  consultation: typeof consultations.$inferSelect,
  event: MessageReceivedEvent,
): Promise<boolean> {
  const { db, scheduler } = deps;

  // Atomic check-and-set: only update if still pending (prevents timeout race)
  const updated = await db
    .update(consultations)
    .set({
      status: 'replied',
      summary: event.content,
      repliedAt: new Date(),
    })
    .where(
      and(
        eq(consultations.id, consultation.id),
        eq(consultations.status, 'pending'),
      ),
    )
    .returning();

  if (updated.length === 0) {
    logger.info('[conversations] Staff reply arrived after timeout — ignored', {
      consultationId: consultation.id,
    });
    return false;
  }

  // Store reply in chat state for the agent to pick up
  const state = getChatState();
  await state.set(
    `consultation:${consultation.conversationId}`,
    {
      reply: event.content,
      staffId: consultation.staffContactId,
      consultationId: consultation.id,
    },
    // TTL: 1 hour — agent should pick this up quickly
    60 * 60 * 1000,
  );

  // Clear hasPendingEscalation if no other pending consultations remain
  const [remaining] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(consultations)
    .where(
      and(
        eq(consultations.conversationId, consultation.conversationId),
        eq(consultations.status, 'pending'),
        ne(consultations.id, consultation.id),
      ),
    );
  if ((remaining?.count ?? 0) === 0) {
    await db
      .update(conversations)
      .set({ hasPendingEscalation: false })
      .where(eq(conversations.id, consultation.conversationId));

    // Escalation cleared — conversation may move from attention back to ai
    await deps.realtime.notify({
      table: 'conversations',
      id: consultation.conversationId,
      prevTab: 'attention',
      tab: 'ai',
    });
  }

  // Queue channel-reply so the agent processes the consultation response
  await scheduler.add('ai:channel-reply', {
    conversationId: consultation.conversationId,
  });

  logger.info('[conversations] consultation_reply', {
    consultationId: consultation.id,
    conversationId: consultation.conversationId,
    outcome: 'replied',
  });

  return true;
}

export async function checkConsultationTimeouts(
  deps: ConsultDeps,
): Promise<number> {
  const { db } = deps;
  const now = new Date();

  // Find pending consultations past their timeout
  const timedOut = await db
    .select()
    .from(consultations)
    .where(
      and(
        eq(consultations.status, 'pending'),
        lt(
          sql`${consultations.requestedAt} + (${consultations.timeoutMinutes} * interval '1 minute')`,
          sql`${now}`,
        ),
      ),
    );

  if (timedOut.length === 0) return 0;

  // Mark as timed out — atomic: only if still pending (prevents race with staff reply)
  for (const c of timedOut) {
    const updated = await db
      .update(consultations)
      .set({ status: 'timeout' })
      .where(
        and(eq(consultations.id, c.id), eq(consultations.status, 'pending')),
      )
      .returning();

    if (updated.length === 0) continue; // Staff replied in the meantime

    // Store timeout flag in chat state so agent knows
    const state = getChatState();
    await state.set(
      `consultation:${c.conversationId}`,
      { timeout: true, consultationId: c.id },
      60 * 60 * 1000,
    );

    // Clear hasPendingEscalation if no other pending consultations remain
    const [remaining] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(consultations)
      .where(
        and(
          eq(consultations.conversationId, c.conversationId),
          eq(consultations.status, 'pending'),
        ),
      );
    if ((remaining?.count ?? 0) === 0) {
      await db
        .update(conversations)
        .set({ hasPendingEscalation: false })
        .where(eq(conversations.id, c.conversationId));

      await deps.realtime.notify({
        table: 'conversations',
        id: c.conversationId,
        prevTab: 'attention',
        tab: 'ai',
      });
    }
  }

  logger.info('[conversations] Timed out consultations', {
    count: timedOut.length,
  });

  return timedOut.length;
}
