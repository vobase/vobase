import {
  authUser,
  conflict,
  getCtx,
  notFound,
  unauthorized,
  type VobaseDb,
} from '@vobase/core';
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { validator } from 'hono/validator';
import { z } from 'zod';

import { completeConversation, failConversation } from '../lib/conversation';
import { enqueueDelivery } from '../lib/delivery';
import { getModuleDeps } from '../lib/deps';
import { withdrawMessageSchema } from '../lib/message-types';
import { insertMessage } from '../lib/messages';
import { transition } from '../lib/state-machine';
import {
  channelInstances,
  consultations,
  contacts,
  conversationLabels,
  conversations,
  labels,
  messageFeedback,
  messages,
} from '../schema';

/** Batch-load labels for a set of conversation rows and merge them in. */
async function withLabels<T extends { id: string }>(
  db: VobaseDb,
  rows: T[],
): Promise<
  (T & { labels: { id: string; title: string; color: string | null }[] })[]
> {
  if (rows.length === 0) return [];
  const convIds = rows.map((r) => r.id);
  const labelRows = await db
    .select({
      conversationId: conversationLabels.conversationId,
      labelId: labels.id,
      title: labels.title,
      color: labels.color,
    })
    .from(conversationLabels)
    .innerJoin(labels, eq(conversationLabels.labelId, labels.id))
    .where(inArray(conversationLabels.conversationId, convIds));

  const labelMap = new Map<
    string,
    { id: string; title: string; color: string | null }[]
  >();
  for (const row of labelRows) {
    const arr = labelMap.get(row.conversationId) ?? [];
    arr.push({ id: row.labelId, title: row.title, color: row.color });
    labelMap.set(row.conversationId, arr);
  }

  return rows.map((r) => ({ ...r, labels: labelMap.get(r.id) ?? [] }));
}

const updateConversationSchema = z.object({
  status: z.enum(['completed', 'failed']).optional(),
  mode: z.enum(['held', 'ai', 'supervised', 'human']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).nullable().optional(),
  assignee: z.string().nullable().optional(),
});

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const replySchema = z.object({
  content: z.string().min(1),
  isInternal: z.boolean().optional().default(false),
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

  /** GET /conversations/mine — Conversations assigned to the current user. */
  .get('/conversations/mine', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const { limit, offset } = paginationSchema.parse({
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
    });

    const rows = await db
      .select({
        id: conversations.id,
        status: conversations.status,
        mode: conversations.mode,
        assignee: conversations.assignee,
        assignedAt: conversations.assignedAt,
        priority: conversations.priority,
        contactId: conversations.contactId,
        contactName: contacts.name,
        agentId: conversations.agentId,
        channelInstanceId: conversations.channelInstanceId,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
        lastMessageContent: conversations.lastMessageContent,
        lastMessageAt: conversations.lastMessageAt,
        lastMessageType: conversations.lastMessageType,
      })
      .from(conversations)
      .leftJoin(contacts, eq(conversations.contactId, contacts.id))
      .where(
        and(
          eq(conversations.assignee, user.id),
          eq(conversations.status, 'active'),
        ),
      )
      .orderBy(
        sql`CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`,
        asc(conversations.assignedAt),
      )
      .limit(limit)
      .offset(offset);

    return c.json(rows);
  })
  /** GET /conversations/queue — Unassigned escalated conversations waiting to be claimed. */
  .get('/conversations/queue', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const { limit, offset } = paginationSchema.parse({
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
    });

    const rows = await db
      .select({
        id: conversations.id,
        status: conversations.status,
        mode: conversations.mode,
        priority: conversations.priority,
        contactId: conversations.contactId,
        contactName: contacts.name,
        agentId: conversations.agentId,
        channelInstanceId: conversations.channelInstanceId,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
        lastMessageContent: conversations.lastMessageContent,
        lastMessageAt: conversations.lastMessageAt,
        lastMessageType: conversations.lastMessageType,
      })
      .from(conversations)
      .leftJoin(contacts, eq(conversations.contactId, contacts.id))
      .where(
        and(
          sql`${conversations.assignee} IS NULL`,
          inArray(conversations.mode, ['human', 'supervised']),
          eq(conversations.status, 'active'),
        ),
      )
      .orderBy(
        sql`CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`,
        asc(conversations.createdAt),
      )
      .limit(limit)
      .offset(offset);

    return c.json(rows);
  })
  /** GET /conversations/attention — Attention tab: human/supervised/held or pending escalation. */
  .get('/conversations/attention', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const { limit, offset } = paginationSchema.parse({
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
    });

    const rows = await db
      .select({
        id: conversations.id,
        status: conversations.status,
        mode: conversations.mode,
        priority: conversations.priority,
        contactId: conversations.contactId,
        contactName: contacts.name,
        channelInstanceId: conversations.channelInstanceId,
        channelType: channelInstances.type,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
        lastMessageContent: conversations.lastMessageContent,
        lastMessageAt: conversations.lastMessageAt,
        lastMessageType: conversations.lastMessageType,
        hasPendingEscalation: conversations.hasPendingEscalation,
        waitingSince: conversations.waitingSince,
        unreadCount: conversations.unreadCount,
      })
      .from(conversations)
      .leftJoin(contacts, eq(conversations.contactId, contacts.id))
      .leftJoin(
        channelInstances,
        eq(conversations.channelInstanceId, channelInstances.id),
      )
      .where(
        and(
          eq(conversations.status, 'active'),
          or(
            inArray(conversations.mode, ['human', 'supervised', 'held']),
            eq(conversations.hasPendingEscalation, true),
          ),
        ),
      )
      .orderBy(asc(conversations.waitingSince))
      .limit(limit)
      .offset(offset);

    return c.json(await withLabels(db, rows));
  })
  /** GET /conversations/ai-active — AI Handling tab: active AI conversations. */
  .get('/conversations/ai-active', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const { limit, offset } = paginationSchema.parse({
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
    });

    const rows = await db
      .select({
        id: conversations.id,
        status: conversations.status,
        mode: conversations.mode,
        priority: conversations.priority,
        contactId: conversations.contactId,
        contactName: contacts.name,
        channelInstanceId: conversations.channelInstanceId,
        channelType: channelInstances.type,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
        lastMessageContent: conversations.lastMessageContent,
        lastMessageAt: conversations.lastMessageAt,
        lastMessageType: conversations.lastMessageType,
        hasPendingEscalation: conversations.hasPendingEscalation,
        waitingSince: conversations.waitingSince,
        unreadCount: conversations.unreadCount,
      })
      .from(conversations)
      .leftJoin(contacts, eq(conversations.contactId, contacts.id))
      .leftJoin(
        channelInstances,
        eq(conversations.channelInstanceId, channelInstances.id),
      )
      .where(
        and(eq(conversations.status, 'active'), eq(conversations.mode, 'ai')),
      )
      .orderBy(desc(conversations.updatedAt))
      .limit(limit)
      .offset(offset);

    return c.json(await withLabels(db, rows));
  })
  /** GET /conversations/resolved — Done tab: completed and failed conversations. */
  .get('/conversations/resolved', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const { limit, offset } = paginationSchema.parse({
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
    });

    const rows = await db
      .select({
        id: conversations.id,
        status: conversations.status,
        mode: conversations.mode,
        priority: conversations.priority,
        contactId: conversations.contactId,
        contactName: contacts.name,
        channelInstanceId: conversations.channelInstanceId,
        channelType: channelInstances.type,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
        lastMessageContent: conversations.lastMessageContent,
        lastMessageAt: conversations.lastMessageAt,
        lastMessageType: conversations.lastMessageType,
        hasPendingEscalation: conversations.hasPendingEscalation,
        waitingSince: conversations.waitingSince,
        unreadCount: conversations.unreadCount,
      })
      .from(conversations)
      .leftJoin(contacts, eq(conversations.contactId, contacts.id))
      .leftJoin(
        channelInstances,
        eq(conversations.channelInstanceId, channelInstances.id),
      )
      .where(inArray(conversations.status, ['completed', 'failed']))
      .orderBy(desc(conversations.updatedAt))
      .limit(limit)
      .offset(offset);

    return c.json(await withLabels(db, rows));
  })
  /** GET /conversations/counts — Badge counts for all three tabs. */
  .get('/conversations/counts', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const [counts] = await db
      .select({
        attention: sql<number>`count(*) FILTER (WHERE status = 'active' AND (mode IN ('human', 'supervised', 'held') OR has_pending_escalation))::int`,
        ai: sql<number>`count(*) FILTER (WHERE status = 'active' AND mode = 'ai')::int`,
        done: sql<number>`count(*) FILTER (WHERE status IN ('completed', 'failed'))::int`,
      })
      .from(conversations);

    return c.json(counts ?? { attention: 0, ai: 0, done: 0 });
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
  /** GET /conversations/:id/messages — Load messages from the messages table with cursor pagination. */
  .get(
    '/conversations/:id/messages',
    validator('query', (value) => {
      return z
        .object({
          limit: z.coerce.number().int().min(1).max(100).default(50),
          before: z.string().optional(),
        })
        .parse(value);
    }),
    async (c) => {
      const { db, user } = getCtx(c);
      if (!user) throw unauthorized();

      const conversationId = c.req.param('id');
      const { limit, before } = c.req.valid('query');

      const [conversation] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId));

      if (!conversation) throw notFound('Conversation not found');

      const conditions = [eq(messages.conversationId, conversationId)];
      if (before) {
        conditions.push(lt(messages.createdAt, new Date(before)));
      }

      const rows = await db
        .select()
        .from(messages)
        .where(and(...conditions))
        .orderBy(desc(messages.createdAt))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor =
        hasMore && page.length > 0
          ? page[page.length - 1].createdAt.toISOString()
          : null;

      return c.json({
        messages: page.reverse(),
        hasMore,
        nextCursor,
      });
    },
  )
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

    const { realtime } = getModuleDeps();
    const deps = { db, realtime };

    // status → terminal state: complete or fail, then return immediately
    if (body.status === 'completed' || body.status === 'failed') {
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
      const [updated] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId));
      return c.json(updated);
    }

    // mode change → machine (only when assignee is not being set; ASSIGN handles mode atomically)
    if (body.mode && body.assignee === undefined) {
      const modeResult = await transition(deps, conversationId, {
        type: 'SET_MODE',
        mode: body.mode,
        userId: user.id,
      });
      if (!modeResult.ok) {
        if (modeResult.code === 'CONCURRENCY_CONFLICT')
          return c.json({ error: modeResult.error }, 409);
        return c.json({ error: modeResult.error }, 400);
      }
    }

    // assignee change → machine (ASSIGN atomically sets mode=human; UNASSIGN clears)
    if (body.assignee !== undefined) {
      const assignResult = body.assignee
        ? await transition(deps, conversationId, {
            type: 'ASSIGN',
            assignee: body.assignee,
            userId: user.id,
          })
        : await transition(deps, conversationId, {
            type: 'UNASSIGN',
            userId: user.id,
          });
      if (!assignResult.ok) {
        if (assignResult.code === 'CONCURRENCY_CONFLICT')
          return c.json({ error: assignResult.error }, 409);
        return c.json({ error: assignResult.error }, 400);
      }
    }

    // priority is a direct write — not a state transition
    if (body.priority !== undefined) {
      await db
        .update(conversations)
        .set({ priority: body.priority })
        .where(eq(conversations.id, conversationId));
    }

    const [updated] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));

    return c.json(updated);
  })
  /** POST /conversations/:id/reply — Human agent reply: insert message + enqueue delivery. */
  .post('/conversations/:id/reply', async (c) => {
    const { db, user, scheduler, realtime } = getCtx(c);
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

    if (conversation.status !== 'active') {
      throw notFound('Conversation is not active');
    }

    let channelType = 'web';
    if (conversation.channelInstanceId) {
      const [instance] = await db
        .select({ id: channelInstances.id, type: channelInstances.type })
        .from(channelInstances)
        .where(eq(channelInstances.id, conversation.channelInstanceId));
      if (instance) channelType = instance.type;
    }

    // Prefix staff name so the agent (and customer on non-email channels) can
    // identify who is speaking. Email channel handles sender identity natively.
    const staffName = user.name ?? user.email;
    const content =
      !body.isInternal && channelType !== 'email'
        ? `[Staff: ${staffName}] ${body.content}`
        : body.content;

    const msg = await insertMessage(db, realtime, {
      conversationId,
      messageType: 'outgoing',
      contentType: 'text',
      content,
      status: body.isInternal ? null : 'queued',
      senderId: user.id,
      senderType: 'user',
      channelType: channelType ?? null,
      private: body.isInternal ?? false,
    });

    if (!body.isInternal) {
      await enqueueDelivery(scheduler, msg.id);
    }

    return c.json({ success: true, channelType, messageId: msg.id }, 201);
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
    const { realtime } = getModuleDeps();

    const result = await transition({ db, realtime }, conversationId, {
      type: 'HANDBACK',
      userId: user.id,
    });

    if (!result.ok) {
      if (result.code === 'CONCURRENCY_CONFLICT')
        return c.json({ error: result.error }, 409);
      return c.json({ error: result.error }, 400);
    }

    return c.json({ success: true, mode: 'ai' });
  })
  /** POST /conversations/:id/claim — Staff claims an unassigned escalated conversation. */
  .post('/conversations/:id/claim', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const conversationId = c.req.param('id');
    const { realtime } = getModuleDeps();

    const result = await transition({ db, realtime }, conversationId, {
      type: 'CLAIM',
      userId: user.id,
    });

    if (!result.ok) {
      if (
        result.code === 'CONCURRENCY_CONFLICT' ||
        result.code === 'GUARD_FAILED'
      ) {
        throw conflict('Conversation already claimed or not available');
      }
      throw notFound('Conversation not found or not active');
    }

    return c.json({ success: true, assignee: user.id });
  })
  /** POST /sessions/:id/approve-draft — Approve a supervised AI draft for sending. */
  .post('/conversations/:id/approve-draft', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const conversationId = c.req.param('id');
    const { realtime, scheduler } = getModuleDeps();

    // Find pending draft activity message
    const [draft] = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.messageType, 'activity'),
          eq(messages.resolutionStatus, 'pending'),
          sql`${messages.contentData}->>'eventType' = 'agent.draft_generated'`,
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(1);

    if (!draft) throw notFound('No pending draft found');

    // Optimistic locking
    const updated = await db
      .update(messages)
      .set({ resolutionStatus: 'reviewed' })
      .where(
        and(
          eq(messages.id, draft.id),
          eq(messages.resolutionStatus, 'pending'),
        ),
      )
      .returning();

    if (updated.length === 0) {
      throw conflict('Draft already reviewed or dismissed');
    }

    // Enqueue the draft content as a new outgoing message
    const draftData = (draft.contentData ?? {}) as Record<string, unknown>;
    const draftContent = (draftData.draftContent as string) ?? '';

    if (draftContent) {
      const msg = await insertMessage(db, realtime, {
        conversationId,
        messageType: 'outgoing',
        contentType: 'text',
        content: draftContent,
        status: 'queued',
        senderId: 'agent',
        senderType: 'agent',
        channelType: draft.channelType ?? null,
        private: false,
      });
      await enqueueDelivery(scheduler, msg.id);
    }

    return c.json({ success: true, draftId: draft.id });
  })
  /** POST /conversations/:id/typing — Staff signals typing (fire-and-forget NOTIFY). */
  .post('/conversations/:id/typing', async (c) => {
    const { user } = getCtx(c);
    if (!user) throw unauthorized();
    const conversationId = c.req.param('id');
    const { realtime } = getModuleDeps();
    await realtime.notify({
      table: 'conversations-typing',
      id: conversationId,
      action: `${user.id}:${user.name ?? user.email}`,
    });
    return c.json({ ok: true });
  })
  /** POST /conversations/:id/read — Mark conversation as read by current user. */
  .post('/conversations/:id/read', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();
    const conversationId = c.req.param('id');

    const { realtime } = getModuleDeps();
    await db
      .update(conversations)
      .set({ unreadCount: 0, agentLastSeenAt: new Date() })
      .where(eq(conversations.id, conversationId));
    // Notify conversation update only — no activity message for reads
    // (creating an activity message would trigger SSE → re-render → re-read loop)
    await realtime
      .notify({ table: 'conversations', id: conversationId, action: 'update' })
      .catch(() => {});
    return c.json({ ok: true });
  })
  /** POST /conversations/:id/messages/:messageId/feedback — Toggle reaction or add feedback message. */
  .post('/conversations/:id/messages/:messageId/feedback', async (c) => {
    const { db, user } = getCtx(c);
    const conversationId = c.req.param('id');
    const messageId = c.req.param('messageId');
    const body = z
      .object({
        rating: z.enum(['positive', 'negative']),
        reason: z.string().max(1000).optional(),
      })
      .parse(await c.req.json());

    if (!user) throw unauthorized();

    const { realtime } = getModuleDeps();

    if (body.reason) {
      // Feedback message — always insert new entry
      await db.insert(messageFeedback).values({
        conversationId,
        messageId,
        rating: body.rating,
        reason: body.reason,
        userId: user.id,
        contactId: null,
      });
      realtime.notify({ table: 'conversations-feedback', id: conversationId });
      return c.json({ ok: true, action: 'added' });
    }

    // Reaction (no reason) — unique per user per message, toggle
    const action = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: messageFeedback.id, rating: messageFeedback.rating })
        .from(messageFeedback)
        .where(
          and(
            eq(messageFeedback.conversationId, conversationId),
            eq(messageFeedback.messageId, messageId),
            eq(messageFeedback.userId, user.id),
            isNull(messageFeedback.reason),
          ),
        );

      if (existing?.rating === body.rating) {
        // Same reaction → toggle off
        await tx
          .delete(messageFeedback)
          .where(eq(messageFeedback.id, existing.id));
        return 'removed' as const;
      }

      // Different or no existing reaction → replace
      if (existing) {
        await tx
          .delete(messageFeedback)
          .where(eq(messageFeedback.id, existing.id));
      }
      await tx.insert(messageFeedback).values({
        conversationId,
        messageId,
        rating: body.rating,
        reason: null,
        userId: user.id,
        contactId: null,
      });
      return 'added' as const;
    });

    realtime.notify({ table: 'conversations-feedback', id: conversationId });
    return c.json({ ok: true, action });
  })
  /** DELETE /conversations/:id/messages/:messageId/feedback/:feedbackId — Remove a feedback entry. */
  .delete(
    '/conversations/:id/messages/:messageId/feedback/:feedbackId',
    async (c) => {
      const { db, user } = getCtx(c);
      if (!user) throw unauthorized();
      const conversationId = c.req.param('id');
      const feedbackId = c.req.param('feedbackId');

      await db
        .delete(messageFeedback)
        .where(
          and(
            eq(messageFeedback.id, feedbackId),
            eq(messageFeedback.conversationId, conversationId),
            eq(messageFeedback.userId, user.id),
          ),
        );

      const { realtime } = getModuleDeps();
      realtime.notify({ table: 'conversations-feedback', id: conversationId });
      return c.json({ ok: true, action: 'removed' });
    },
  )
  /** GET /conversations/:id/feedback — List all reactions with user info. */
  .get('/conversations/:id/feedback', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();
    const conversationId = c.req.param('id');

    const rows = await db
      .select({
        id: messageFeedback.id,
        messageId: messageFeedback.messageId,
        rating: messageFeedback.rating,
        reason: messageFeedback.reason,
        userId: messageFeedback.userId,
        userName: authUser.name,
        userImage: authUser.image,
      })
      .from(messageFeedback)
      .leftJoin(authUser, eq(messageFeedback.userId, authUser.id))
      .where(eq(messageFeedback.conversationId, conversationId))
      .orderBy(asc(messageFeedback.createdAt));

    return c.json(rows);
  })
  /** POST /conversations/:id/messages/:mid/retry — Retry delivery of a failed message. */
  .post('/conversations/:id/messages/:mid/retry', async (c) => {
    const { db, user, scheduler } = getCtx(c);
    if (!user) throw unauthorized();

    const messageId = c.req.param('mid');
    const [message] = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.id, messageId),
          eq(messages.conversationId, c.req.param('id')),
        ),
      );

    if (!message) throw notFound('Message not found');
    if (message.status !== 'failed') {
      return c.json({ error: 'Only failed messages can be retried' }, 400);
    }

    await db
      .update(messages)
      .set({ status: 'queued', failureReason: null })
      .where(eq(messages.id, messageId));

    await enqueueDelivery(scheduler, messageId);

    return c.json({ ok: true });
  })
  /** PATCH /conversations/:id/messages/:mid — Withdraw a message. */
  .patch('/conversations/:id/messages/:mid', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const body = withdrawMessageSchema.parse(await c.req.json());
    const messageId = c.req.param('mid');

    const [message] = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.id, messageId),
          eq(messages.conversationId, c.req.param('id')),
        ),
      );

    if (!message) throw notFound('Message not found');

    // Only sender or admin can withdraw
    if (message.senderId !== user.id && user.role !== 'admin') {
      return c.json({ error: 'Not authorized to withdraw this message' }, 403);
    }

    const [updated] = await db
      .update(messages)
      .set({ withdrawn: body.withdrawn })
      .where(eq(messages.id, messageId))
      .returning();

    return c.json(updated);
  });
