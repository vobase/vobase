import {
  authUser,
  getCtx,
  notFound,
  unauthorized,
  type VobaseDb,
} from '@vobase/core';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  ne,
  notInArray,
  notLike,
  sql,
} from 'drizzle-orm';
import { Hono } from 'hono';
import { validator } from 'hono/validator';
import { z } from 'zod';

import { type InboxTab } from '../lib/activity-events';
import { failConversation, resolveConversation } from '../lib/conversation';
import { enqueueDelivery } from '../lib/delivery';
import { getModuleDeps } from '../lib/deps';
import { withdrawMessageSchema } from '../lib/message-types';
import { insertMessage } from '../lib/messages';
import { transition } from '../lib/state-machine';
import {
  channelInstances,
  contactLabels,
  contacts,
  conversations,
  labels,
  messageFeedback,
  messages,
} from '../schema';

/** Batch-load contact-level labels for a set of contact-keyed rows. */
async function withContactLabels<T extends { id: string }>(
  db: VobaseDb,
  rows: T[],
): Promise<
  (T & { labels: { id: string; title: string; color: string | null }[] })[]
> {
  if (rows.length === 0) return [];
  const contactIds = rows.map((r) => r.id);
  const labelRows = await db
    .select({
      contactId: contactLabels.contactId,
      labelId: labels.id,
      title: labels.title,
      color: labels.color,
    })
    .from(contactLabels)
    .innerJoin(labels, eq(contactLabels.labelId, labels.id))
    .where(inArray(contactLabels.contactId, contactIds));

  const labelMap = new Map<
    string,
    { id: string; title: string; color: string | null }[]
  >();
  for (const row of labelRows) {
    const arr = labelMap.get(row.contactId) ?? [];
    arr.push({ id: row.labelId, title: row.title, color: row.color });
    labelMap.set(row.contactId, arr);
  }

  return rows.map((r) => ({ ...r, labels: labelMap.get(r.id) ?? [] }));
}

/** Get qualifying contact IDs for a tab. */
async function getTabContactIds(
  db: VobaseDb,
  tab: InboxTab,
): Promise<string[]> {
  if (tab === 'active') {
    const rows = await db
      .selectDistinct({ contactId: conversations.contactId })
      .from(conversations)
      .where(
        and(
          eq(conversations.status, 'active'),
          eq(conversations.onHold, false),
        ),
      );
    return rows.map((r) => r.contactId);
  }

  if (tab === 'on-hold') {
    // Contacts where ALL active conversations are on-hold (none are actively being handled)
    const heldRows = await db
      .selectDistinct({ contactId: conversations.contactId })
      .from(conversations)
      .where(
        and(eq(conversations.status, 'active'), eq(conversations.onHold, true)),
      );
    const heldIds = heldRows.map((r) => r.contactId);

    // Exclude contacts that also have non-held active conversations (those belong in Active tab)
    if (heldIds.length === 0) return [];
    const activeRows = await db
      .selectDistinct({ contactId: conversations.contactId })
      .from(conversations)
      .where(
        and(
          eq(conversations.status, 'active'),
          eq(conversations.onHold, false),
        ),
      );
    const activeIds = new Set(activeRows.map((r) => r.contactId));
    return heldIds.filter((id) => !activeIds.has(id));
  }

  // Done: contacts where NO non-terminal conversation exists
  const nonTerminalRows = await db
    .selectDistinct({ contactId: conversations.contactId })
    .from(conversations)
    .where(notInArray(conversations.status, ['resolved', 'failed']));
  const nonTerminalIds = new Set(nonTerminalRows.map((r) => r.contactId));

  const allContactRows = await db
    .selectDistinct({ contactId: conversations.contactId })
    .from(conversations);
  return allContactRows
    .map((r) => r.contactId)
    .filter((id) => !nonTerminalIds.has(id));
}

/** Build contact-level aggregated rows for a tab. */
async function buildContactRows(
  db: VobaseDb,
  tab: InboxTab,
  limit: number,
  offset: number,
  userId?: string,
) {
  const contactIds = await getTabContactIds(db, tab);
  if (contactIds.length === 0) return [];

  const [reprRows, channelRows, contactRows, latestMsgRows] = await Promise.all(
    [
      // Representative conversation per contact
      db
        .select({
          contactId: conversations.contactId,
          status: conversations.status,
          assignee: conversations.assignee,
          onHold: conversations.onHold,
          priority: conversations.priority,
          resolvedAt: conversations.resolvedAt,
        })
        .from(conversations)
        .where(
          and(
            inArray(conversations.contactId, contactIds),
            tab === 'done'
              ? inArray(conversations.status, ['resolved', 'failed'])
              : eq(conversations.status, 'active'),
          ),
        ),

      // Channel types per contact
      db
        .selectDistinct({
          contactId: conversations.contactId,
          channelType: channelInstances.type,
        })
        .from(conversations)
        .innerJoin(
          channelInstances,
          eq(conversations.channelInstanceId, channelInstances.id),
        )
        .where(inArray(conversations.contactId, contactIds)),

      // Contact info
      db.select().from(contacts).where(inArray(contacts.id, contactIds)),

      // Latest non-activity message per contact (for preview + sorting)
      db
        .select({
          contactId: conversations.contactId,
          content: messages.content,
          messageType: messages.messageType,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .innerJoin(conversations, eq(messages.conversationId, conversations.id))
        .where(
          and(
            inArray(conversations.contactId, contactIds),
            ne(messages.messageType, 'activity'),
            eq(messages.private, false),
          ),
        )
        .orderBy(desc(messages.createdAt)),
    ],
  );

  // Pick first representative per contact
  const reprMap = new Map<string, (typeof reprRows)[0]>();
  for (const row of reprRows) {
    if (!reprMap.has(row.contactId)) {
      reprMap.set(row.contactId, row);
    }
  }

  const channelMap = new Map<string, string[]>();
  for (const row of channelRows) {
    const arr = channelMap.get(row.contactId) ?? [];
    arr.push(row.channelType);
    channelMap.set(row.contactId, arr);
  }

  // Latest message per contact (first match from time-ordered results)
  const latestMsgMap = new Map<
    string,
    { content: string; messageType: string; createdAt: Date }
  >();
  for (const row of latestMsgRows) {
    if (!latestMsgMap.has(row.contactId)) {
      latestMsgMap.set(row.contactId, {
        content: row.content,
        messageType: row.messageType,
        createdAt: row.createdAt,
      });
    }
  }

  // Compute unread count per contact: incoming messages after last outgoing per conversation
  const unreadMap = new Map<string, number>();
  if (contactIds.length > 0) {
    const unreadRows = await db
      .select({
        contactId: conversations.contactId,
        count: sql<number>`count(*)::int`,
      })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(
        and(
          inArray(conversations.contactId, contactIds),
          eq(conversations.status, 'active'),
          eq(messages.messageType, 'incoming'),
          notLike(conversations.assignee, 'agent:%'),
          sql`${messages.createdAt} > COALESCE(
            (SELECT MAX(m2.created_at) FROM ${messages} m2
             WHERE m2.conversation_id = ${messages.conversationId}
             AND m2.message_type = 'outgoing'),
            '1970-01-01'::timestamptz
          )`,
        ),
      )
      .groupBy(conversations.contactId);

    for (const row of unreadRows) {
      unreadMap.set(row.contactId, row.count);
    }
  }

  // Compute hasMention per contact for current user
  const mentionMap = new Map<string, boolean>();
  if (userId) {
    const mentionRows = await db
      .selectDistinct({ contactId: conversations.contactId })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(
        and(
          inArray(conversations.contactId, contactIds),
          sql`${messages.mentions} @> ${JSON.stringify([{ targetId: userId, targetType: 'user' }])}::jsonb`,
        ),
      );
    for (const row of mentionRows) {
      mentionMap.set(row.contactId, true);
    }
  }

  const merged = contactRows.map((c) => {
    const repr = reprMap.get(c.id);
    const latestMsg = latestMsgMap.get(c.id);
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      role: c.role,
      channels: channelMap.get(c.id) ?? [],
      status: repr?.status ?? 'resolved',
      assignee: repr?.assignee ?? null,
      onHold: repr?.onHold ?? false,
      priority: repr?.priority ?? null,
      unreadCount: unreadMap.get(c.id) ?? 0,
      lastMessageContent: latestMsg?.content?.slice(0, 200) ?? null,
      lastMessageAt: latestMsg?.createdAt ?? null,
      lastMessageType: latestMsg?.messageType ?? null,
      hasMention: mentionMap.get(c.id) ?? false,
    };
  });

  // Sort by lastMessageAt DESC
  merged.sort((a, b) => {
    const aTime = a.lastMessageAt?.getTime() ?? 0;
    const bTime = b.lastMessageAt?.getTime() ?? 0;
    return bTime - aTime;
  });

  return merged.slice(offset, offset + limit);
}

const updateConversationSchema = z.object({
  status: z.enum(['resolved', 'failed']).optional(),
  onHold: z.boolean().optional(),
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
  replyToMessageId: z.string().optional(),
  cc: z.array(z.string().email()).optional(),
  subject: z.string().optional(),
});

export const conversationsDetailHandlers = new Hono()
  /** GET /conversations — List conversations with filters and pagination. */
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
        assignee: conversations.assignee,
        onHold: conversations.onHold,
        assignedAt: conversations.assignedAt,
        priority: conversations.priority,
        contactId: conversations.contactId,
        contactName: contacts.name,
        agentId: conversations.agentId,
        channelInstanceId: conversations.channelInstanceId,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
        lastMessageContent: sql<string | null>`(
          SELECT m.content FROM ${messages} m
          WHERE m.conversation_id = ${conversations.id}
          AND m.message_type != 'activity' AND m.private = false
          ORDER BY m.created_at DESC LIMIT 1
        )`.as('last_message_content'),
        lastMessageAt: sql<Date | null>`(
          SELECT m.created_at FROM ${messages} m
          WHERE m.conversation_id = ${conversations.id}
          AND m.message_type != 'activity' AND m.private = false
          ORDER BY m.created_at DESC LIMIT 1
        )`.as('last_message_at'),
        lastMessageType: sql<string | null>`(
          SELECT m.message_type FROM ${messages} m
          WHERE m.conversation_id = ${conversations.id}
          AND m.message_type != 'activity' AND m.private = false
          ORDER BY m.created_at DESC LIMIT 1
        )`.as('last_message_type'),
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
  /** GET /conversations/active — Active tab: contacts with non-held active conversations. */
  .get('/conversations/active', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const { limit, offset } = paginationSchema.parse({
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
    });

    const rows = await buildContactRows(db, 'active', limit, offset, user.id);
    return c.json(await withContactLabels(db, rows));
  })
  /** GET /conversations/on-hold — On-hold tab: contacts with held active conversations. */
  .get('/conversations/on-hold', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const { limit, offset } = paginationSchema.parse({
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
    });

    const rows = await buildContactRows(db, 'on-hold', limit, offset, user.id);
    return c.json(await withContactLabels(db, rows));
  })
  /** GET /conversations/resolved — Done tab: contacts where all conversations are terminal. */
  .get('/conversations/resolved', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const { limit, offset } = paginationSchema.parse({
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
    });

    const rows = await buildContactRows(db, 'done', limit, offset, user.id);
    return c.json(await withContactLabels(db, rows));
  })
  /** GET /conversations/counts — Contact-level badge counts for all tabs. */
  .get('/conversations/counts', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const [activeIds, onHoldIds, doneIds] = await Promise.all([
      getTabContactIds(db, 'active'),
      getTabContactIds(db, 'on-hold'),
      getTabContactIds(db, 'done'),
    ]);

    return c.json({
      active: activeIds.length,
      onHold: onHoldIds.length,
      done: doneIds.length,
    });
  })
  /** GET /conversations/mentions — Contacts where current user has unread @mentions. */
  .get('/conversations/mentions', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const { limit, offset } = paginationSchema.parse({
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
    });

    // Find contact IDs where any message @mentions the current user
    const mentionRows = await db
      .selectDistinct({ contactId: conversations.contactId })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(
        sql`${messages.mentions} @> ${JSON.stringify([{ targetId: user.id, targetType: 'user' }])}::jsonb`,
      );

    const contactIds = mentionRows.map((r) => r.contactId);
    if (contactIds.length === 0) return c.json([]);

    const contactRows = await db
      .select()
      .from(contacts)
      .where(inArray(contacts.id, contactIds))
      .limit(limit)
      .offset(offset);

    return c.json(await withContactLabels(db, contactRows));
  })
  /** GET /conversations/:id — Conversation detail. */
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
  /** GET /conversations/:id/messages — Load messages with cursor pagination. */
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
  /**
   * GET /conversations/:id/timeline-messages — Unified timeline: all messages
   * for the same contact + channel across ALL conversations.
   */
  .get(
    '/conversations/:id/timeline-messages',
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

      // 1. Get the anchor conversation to find contactId + channelInstanceId
      const [anchor] = await db
        .select({
          contactId: conversations.contactId,
          channelInstanceId: conversations.channelInstanceId,
        })
        .from(conversations)
        .where(eq(conversations.id, conversationId));

      if (!anchor) throw notFound('Conversation not found');

      // 2. Get all conversations for this contact + channel (for boundary metadata)
      const siblingConversations = await db
        .select({
          id: conversations.id,
          status: conversations.status,
          outcome: conversations.outcome,
          startedAt: conversations.startedAt,
          resolvedAt: conversations.resolvedAt,
          reopenCount: conversations.reopenCount,
        })
        .from(conversations)
        .where(
          and(
            eq(conversations.contactId, anchor.contactId),
            eq(conversations.channelInstanceId, anchor.channelInstanceId),
          ),
        )
        .orderBy(asc(conversations.startedAt));

      const siblingIds = siblingConversations.map((i) => i.id);

      // 3. Fetch messages across all sibling conversations with cursor pagination
      const conditions = [inArray(messages.conversationId, siblingIds)];
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
        conversations: siblingConversations.map((i) => ({
          ...i,
          startedAt: i.startedAt.toISOString(),
          resolvedAt: i.resolvedAt?.toISOString() ?? null,
        })),
        currentConversationId: conversationId,
      });
    },
  )
  /** PATCH /conversations/:id — Update conversation status. */
  .patch('/conversations/:id', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const body = updateConversationSchema.parse(await c.req.json());
    const conversationId = c.req.param('id');

    const [existing] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));

    if (!existing) throw notFound('Conversation not found');

    const { realtime } = getModuleDeps();
    const deps = { db, realtime };

    // status → terminal state: resolve or fail, then return immediately
    if (body.status === 'resolved' || body.status === 'failed') {
      if (body.status === 'resolved') {
        await resolveConversation(db, conversationId, realtime);
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

    // assignee change → REASSIGN transition
    if (body.assignee !== undefined && body.assignee !== null) {
      const assignResult = await transition(deps, conversationId, {
        type: 'REASSIGN',
        assignee: body.assignee,
        reason: 'Manual reassignment',
        userId: user.id,
      });
      if (!assignResult.ok) {
        if (assignResult.code === 'CONCURRENCY_CONFLICT')
          return c.json({ error: assignResult.error }, 409);
        return c.json({ error: assignResult.error }, 400);
      }
    }

    // onHold toggle → HOLD/UNHOLD transition
    if (body.onHold !== undefined) {
      const holdResult = body.onHold
        ? await transition(deps, conversationId, {
            type: 'HOLD',
            reason: 'Manually placed on hold',
            userId: user.id,
          })
        : await transition(deps, conversationId, {
            type: 'UNHOLD',
            userId: user.id,
          });
      if (!holdResult.ok) {
        if (holdResult.code === 'CONCURRENCY_CONFLICT')
          return c.json({ error: holdResult.error }, 409);
        return c.json({ error: holdResult.error }, 400);
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

    const contentData: Record<string, unknown> = {};
    if (body.cc?.length) contentData.cc = body.cc;
    if (body.subject) contentData.subject = body.subject;

    const msg = await insertMessage(db, realtime, {
      conversationId,
      messageType: 'outgoing',
      contentType: 'text',
      content,
      contentData:
        Object.keys(contentData).length > 0 ? contentData : undefined,
      status: body.isInternal ? null : 'queued',
      senderId: user.id,
      senderType: 'user',
      channelType: channelType ?? null,
      private: body.isInternal ?? false,
      replyToMessageId: body.replyToMessageId ?? null,
    });

    if (!body.isInternal) {
      await enqueueDelivery(scheduler, msg.id);
    }

    return c.json({ success: true, channelType, messageId: msg.id }, 201);
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
    const { user } = getCtx(c);
    if (!user) throw unauthorized();
    const conversationId = c.req.param('id');

    // Unread count is now computed from messages — acknowledge read
    const { realtime } = getModuleDeps();
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
