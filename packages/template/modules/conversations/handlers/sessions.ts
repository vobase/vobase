import { conflict, getCtx, notFound, unauthorized } from '@vobase/core';
import { and, asc, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getMemory } from '../../../mastra';
import { emitActivityEvent } from '../lib/activity-events';
import { getConversationsDeps } from '../lib/deps';
import { enqueueMessage } from '../lib/outbox';
import {
  activityEvents,
  channelInstances,
  consultations,
  conversations,
  outbox,
} from '../schema';

const updateConversationSchema = z.object({
  status: z.enum(['paused', 'completed', 'failed']),
});

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const replySchema = z.object({
  content: z.string().min(1),
});

export const conversationsDetailHandlers = new Hono()
  /** GET /sessions — List conversations with filters and pagination. */
  .get('/conversations', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const { limit, offset } = paginationSchema.parse({
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
    });

    const agentId = c.req.query('agentId');
    const contactId = c.req.query('contactId');
    const status = c.req.query('status');
    const channelInstanceId = c.req.query('channelInstanceId');

    const conditions = [];
    if (agentId) conditions.push(eq(conversations.agentId, agentId));
    if (contactId) conditions.push(eq(conversations.contactId, contactId));
    if (status) conditions.push(eq(conversations.status, status));
    if (channelInstanceId)
      conditions.push(eq(conversations.channelInstanceId, channelInstanceId));

    const rows = await db
      .select()
      .from(conversations)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(conversations.createdAt))
      .limit(limit)
      .offset(offset);

    return c.json(rows);
  })
  /** GET /sessions/:id — Conversation detail. */
  .get('/conversations/:id', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, c.req.param('id')));

    if (!conversation) throw notFound('Conversation not found');

    return c.json(conversation);
  })
  /** GET /sessions/:id/messages — Load messages from Mastra Memory, fall back to outbox. */
  .get('/conversations/:id/messages', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const conversationId = c.req.param('id');

    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));

    if (!conversation) throw notFound('Conversation not found');

    // Try Mastra Memory first (has full user+assistant transcript)
    try {
      const memory = getMemory();
      const result = await memory.recall({ threadId: conversationId });
      if (result?.messages && result.messages.length > 0) {
        // Also fetch outbox records so the frontend can show delivery status
        const outboxRecords = await db
          .select({
            id: outbox.id,
            content: outbox.content,
            status: outbox.status,
            createdAt: outbox.createdAt,
          })
          .from(outbox)
          .where(eq(outbox.conversationId, conversationId))
          .orderBy(asc(outbox.createdAt));

        return c.json({
          messages: result.messages,
          outboxRecords,
          source: 'memory',
        });
      }
    } catch {
      // Memory unavailable — fall through to outbox
    }

    // Fall back to outbox messages (agent responses only, no user messages)
    const outboxMessages = await db
      .select({
        id: outbox.id,
        content: outbox.content,
        status: outbox.status,
        createdAt: outbox.createdAt,
      })
      .from(outbox)
      .where(eq(outbox.conversationId, conversationId))
      .orderBy(asc(outbox.createdAt));

    const messages = outboxMessages.map((msg) => ({
      id: msg.id,
      role: 'assistant' as const,
      content: msg.content,
      createdAt: msg.createdAt,
      deliveryStatus: msg.status,
    }));

    return c.json({ messages, source: 'outbox' });
  })
  /** PATCH /sessions/:id — Update conversation status. */
  .patch('/conversations/:id', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const body = updateConversationSchema.parse(await c.req.json());
    const conversationId = c.req.param('id');

    const [existingConversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));

    if (!existingConversation) throw notFound('Conversation not found');

    if (body.status === 'completed' || body.status === 'failed') {
      const { completeConversation, failConversation } = await import(
        '../lib/conversation'
      );
      const { realtime } = getConversationsDeps();
      if (body.status === 'completed') {
        await completeConversation(db, conversationId, realtime);
      } else {
        await failConversation(
          db,
          conversationId,
          'Manually failed by user',
          realtime,
        );
      }
    } else {
      await db
        .update(conversations)
        .set({ status: body.status })
        .where(eq(conversations.id, conversationId));
    }

    const [updated] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));

    return c.json(updated);
  })
  /** POST /sessions/:id/reply — Human agent reply: save to memory + deliver via channel. */
  .post('/conversations/:id/reply', async (c) => {
    const { db, user, scheduler } = getCtx(c);
    if (!user) throw unauthorized();

    const body = replySchema.parse(await c.req.json());
    const conversationId = c.req.param('id');

    const [conversation] = await db
      .select({
        id: conversations.id,
        status: conversations.status,
        contactId: conversations.contactId,
        channelInstanceId: conversations.channelInstanceId,
      })
      .from(conversations)
      .where(eq(conversations.id, conversationId));

    if (!conversation) throw notFound('Conversation not found');

    if (conversation.status !== 'active' && conversation.status !== 'paused') {
      throw notFound('Conversation is not active or paused');
    }

    let channelType = 'web';
    if (conversation.channelInstanceId) {
      const [instance] = await db
        .select({ id: channelInstances.id, type: channelInstances.type })
        .from(channelInstances)
        .where(eq(channelInstances.id, conversation.channelInstanceId));
      if (instance) channelType = instance.type;
    }

    // Save to Mastra Memory so it appears in the conversation transcript
    const staffLabel = user.name ?? user.email;
    const replyText = body.content;
    try {
      const memory = getMemory();
      await memory.saveMessages({
        messages: [
          {
            id: `staff-${Date.now()}`,
            threadId: conversationId,
            resourceId: `contact:${conversation.contactId}`,
            role: 'assistant' as const,
            createdAt: new Date(),
            content: {
              format: 2,
              parts: [
                { type: 'text', text: `[Staff: ${staffLabel}] ${replyText}` },
              ],
              content: `[Staff: ${staffLabel}] ${replyText}`,
            },
          } as unknown as Parameters<
            typeof memory.saveMessages
          >[0]['messages'][number],
        ],
      });
    } catch (err) {
      console.error(
        '[conversations] Failed to save staff reply to memory:',
        err,
      );
    }

    // For non-web channels, also enqueue for outbound delivery to the contact
    if (channelType !== 'web') {
      await enqueueMessage(db, scheduler, {
        conversationId: conversationId,
        content: replyText,
        channelType,
        channelInstanceId: conversation.channelInstanceId ?? undefined,
      });
    }

    return c.json({ success: true, channelType }, 201);
  })
  /** GET /sessions/:id/consultations — List consultations for a conversation. */
  .get('/conversations/:id/consultations', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const conversationId = c.req.param('id');

    const [conversation] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, conversationId));

    if (!conversation) throw notFound('Conversation not found');

    const rows = await db
      .select({
        id: consultations.id,
        conversationId: consultations.conversationId,
        staffContactId: consultations.staffContactId,
        channelType: consultations.channelType,
        reason: consultations.reason,
        summary: consultations.summary,
        status: consultations.status,
        requestedAt: consultations.requestedAt,
        repliedAt: consultations.repliedAt,
        timeoutMinutes: consultations.timeoutMinutes,
        createdAt: consultations.createdAt,
      })
      .from(consultations)
      .where(eq(consultations.conversationId, conversationId))
      .orderBy(desc(consultations.createdAt));

    return c.json(rows);
  })
  /** POST /sessions/:id/handback — Return conversation from human to AI mode. */
  .post('/conversations/:id/handback', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const conversationId = c.req.param('id');
    const { realtime } = getConversationsDeps();

    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));

    if (!conversation) throw notFound('Conversation not found');
    if (
      conversation.handler !== 'human' &&
      conversation.handler !== 'supervised'
    ) {
      return c.json(
        { error: 'Conversation is not in human or supervised mode' },
        400,
      );
    }

    await db
      .update(conversations)
      .set({ handler: 'ai', assignedUserId: null })
      .where(eq(conversations.id, conversationId));

    await emitActivityEvent(db, realtime, {
      type: 'handler.changed',
      userId: user.id,
      source: 'staff',
      conversationId,
      data: { from: conversation.handler, to: 'ai', reason: 'Staff handback' },
    });

    return c.json({ success: true, handler: 'ai' });
  })
  /** POST /sessions/:id/approve-draft — Approve a supervised AI draft for sending. */
  .post('/conversations/:id/approve-draft', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const conversationId = c.req.param('id');
    const { realtime, scheduler } = getConversationsDeps();

    // Find pending draft
    const [draft] = await db
      .select()
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.type, 'agent.draft_generated'),
          eq(activityEvents.conversationId, conversationId),
          eq(activityEvents.resolutionStatus, 'pending'),
        ),
      )
      .orderBy(desc(activityEvents.createdAt))
      .limit(1);

    if (!draft) throw notFound('No pending draft found');

    // Optimistic locking
    const updated = await db
      .update(activityEvents)
      .set({ resolutionStatus: 'reviewed' })
      .where(
        and(
          eq(activityEvents.id, draft.id),
          eq(activityEvents.resolutionStatus, 'pending'),
        ),
      )
      .returning();

    if (updated.length === 0) {
      throw conflict('Draft already reviewed or dismissed');
    }

    // Enqueue the draft content through outbox
    const draftData = draft.data as Record<string, unknown> | null;
    const draftContent = (draftData?.draftContent as string) ?? '';

    if (draftContent) {
      const { enqueueMessage } = await import('../lib/outbox');
      const [conversation] = await db
        .select({ channelInstanceId: conversations.channelInstanceId })
        .from(conversations)
        .where(eq(conversations.id, conversationId));

      await enqueueMessage(
        db,
        scheduler,
        {
          conversationId: conversationId,
          content: draftContent,
          channelType: draft.channelType ?? 'web',
          channelInstanceId: conversation?.channelInstanceId ?? undefined,
        },
        realtime,
      );
    }

    return c.json({ success: true, draftId: draft.id });
  });
