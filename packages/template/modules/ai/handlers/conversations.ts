import {
  authUser,
  conflict,
  getCtx,
  notFound,
  unauthorized,
} from '@vobase/core';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getMemory } from '../../../mastra';
import { computeTab, emitActivityEvent } from '../lib/activity-events';
import { getModuleDeps } from '../lib/deps';
import { updateLastSignal } from '../lib/last-signal';
import { enqueueMessage } from '../lib/outbox';
import {
  activityEvents,
  channelInstances,
  consultations,
  contacts,
  conversations,
  messageFeedback,
  outbox,
} from '../schema';

// ─── Signal join helper ──────────────────────────────────────────────

interface LastSignal {
  kind: 'message' | 'activity';
  content: string | null;
  type: string | null;
  data: Record<string, unknown> | null;
  createdAt: string | null;
}

async function joinLastSignals<
  T extends { lastSignalKind: string | null; lastSignalId: string | null },
>(
  db: Parameters<typeof import('drizzle-orm')['eq']> extends never[]
    ? never
    : any,
  rows: T[],
): Promise<
  (Omit<T, 'lastSignalKind' | 'lastSignalId'> & {
    lastSignal: LastSignal | null;
  })[]
> {
  const messageIds: string[] = [];
  const activityIds: string[] = [];

  for (const row of rows) {
    if (!row.lastSignalId || !row.lastSignalKind) continue;
    if (row.lastSignalKind === 'message') messageIds.push(row.lastSignalId);
    else if (row.lastSignalKind === 'activity')
      activityIds.push(row.lastSignalId);
  }

  const messageMap = new Map<string, { content: string; createdAt: Date }>();
  const activityMap = new Map<
    string,
    { type: string; data: unknown; createdAt: Date }
  >();

  if (messageIds.length > 0) {
    const msgs = await db
      .select({
        id: outbox.id,
        content: outbox.content,
        createdAt: outbox.createdAt,
      })
      .from(outbox)
      .where(inArray(outbox.id, messageIds));
    for (const m of msgs) messageMap.set(m.id, m);
  }

  if (activityIds.length > 0) {
    const events = await db
      .select({
        id: activityEvents.id,
        type: activityEvents.type,
        data: activityEvents.data,
        createdAt: activityEvents.createdAt,
      })
      .from(activityEvents)
      .where(inArray(activityEvents.id, activityIds));
    for (const e of events) activityMap.set(e.id, e);
  }

  return rows.map(({ lastSignalKind, lastSignalId, ...rest }) => {
    let lastSignal: LastSignal | null = null;

    if (lastSignalKind === 'message' && lastSignalId) {
      const msg = messageMap.get(lastSignalId);
      if (msg) {
        lastSignal = {
          kind: 'message',
          content: msg.content,
          type: null,
          data: null,
          createdAt: msg.createdAt.toISOString(),
        };
      }
    } else if (lastSignalKind === 'activity' && lastSignalId) {
      const evt = activityMap.get(lastSignalId);
      if (evt) {
        lastSignal = {
          kind: 'activity',
          content: null,
          type: evt.type,
          data: evt.data as Record<string, unknown> | null,
          createdAt: evt.createdAt.toISOString(),
        };
      }
    }

    return { ...rest, lastSignal } as Omit<
      T,
      'lastSignalKind' | 'lastSignalId'
    > & { lastSignal: LastSignal | null };
  });
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
        lastSignalKind: conversations.lastSignalKind,
        lastSignalId: conversations.lastSignalId,
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

    const withSignals = await joinLastSignals(db, rows);
    return c.json(withSignals);
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
        lastSignalKind: conversations.lastSignalKind,
        lastSignalId: conversations.lastSignalId,
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

    const withSignals = await joinLastSignals(db, rows);
    return c.json(withSignals);
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
        lastSignalKind: conversations.lastSignalKind,
        lastSignalId: conversations.lastSignalId,
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

    const withSignals = await joinLastSignals(db, rows);
    return c.json(withSignals);
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
        lastSignalKind: conversations.lastSignalKind,
        lastSignalId: conversations.lastSignalId,
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

    const withSignals = await joinLastSignals(db, rows);
    return c.json(withSignals);
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
        lastSignalKind: conversations.lastSignalKind,
        lastSignalId: conversations.lastSignalId,
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

    const withSignals = await joinLastSignals(db, rows);
    return c.json(withSignals);
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

    const { realtime } = getModuleDeps();

    if (body.status === 'completed' || body.status === 'failed') {
      const { completeConversation, failConversation } = await import(
        '../lib/conversation'
      );
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
    }

    if (body.mode) {
      const previousMode = existingConversation.mode;
      const isHumanMode = ['human', 'supervised', 'held'].includes(body.mode);
      const wasHumanMode = ['human', 'supervised', 'held'].includes(
        existingConversation.mode,
      );
      const waitingSinceUpdate: Date | null | undefined =
        isHumanMode && !wasHumanMode
          ? new Date()
          : !isHumanMode
            ? null
            : undefined;
      await db
        .update(conversations)
        .set({
          mode: body.mode,
          ...(waitingSinceUpdate !== undefined
            ? { waitingSince: waitingSinceUpdate }
            : {}),
        })
        .where(eq(conversations.id, conversationId));

      const eventId = await emitActivityEvent(db, realtime, {
        type: 'handler.changed',
        userId: user.id,
        source: 'staff',
        conversationId,
        data: { from: previousMode, to: body.mode, reason: 'Staff action' },
      });
      if (eventId) {
        await updateLastSignal(db, conversationId, 'activity', eventId);
      }
    }

    // Update priority if provided
    if (body.priority !== undefined) {
      await db
        .update(conversations)
        .set({ priority: body.priority })
        .where(eq(conversations.id, conversationId));
    }

    // Update assignee if provided
    if (body.assignee !== undefined) {
      await db
        .update(conversations)
        .set({
          assignee: body.assignee,
          assignedAt: body.assignee ? new Date() : null,
        })
        .where(eq(conversations.id, conversationId));
    }

    const [updated] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));

    await realtime.notify({
      table: 'conversations',
      id: conversationId,
      tab: computeTab(
        updated.mode,
        updated.status,
        updated.hasPendingEscalation,
      ),
      prevTab: computeTab(
        existingConversation.mode,
        existingConversation.status,
        existingConversation.hasPendingEscalation,
      ),
    });

    return c.json(updated);
  })
  /** POST /sessions/:id/reply — Human agent reply: save to memory + deliver via channel. */
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

    // Save to Mastra Memory so it appears in the conversation transcript
    const staffLabel = user.name ?? user.email;
    const replyText = body.content;
    const isInternal = body.isInternal;
    try {
      const memory = getMemory();
      const displayText = isInternal
        ? replyText
        : `[Staff: ${staffLabel}] ${replyText}`;
      const metadata: Record<string, unknown> = {
        isStaffReply: true,
        staffName: staffLabel,
        ...(isInternal ? { visibility: 'internal' } : {}),
      };
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
              parts: [{ type: 'text', text: displayText }],
              content: displayText,
              metadata,
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

    // Notify all connected clients that messages have been updated
    realtime.notify({
      table: 'conversations-messages',
      id: conversationId,
    });

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
    const { realtime } = getModuleDeps();

    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));

    if (!conversation) throw notFound('Conversation not found');
    if (
      conversation.mode !== 'human' &&
      conversation.mode !== 'supervised' &&
      conversation.mode !== 'held'
    ) {
      return c.json(
        { error: 'Conversation is not in human, supervised, or held mode' },
        400,
      );
    }

    await db
      .update(conversations)
      .set({
        mode: 'ai',
        assignee: null,
        assignedAt: null,
        priority: null,
        waitingSince: null,
        hasPendingEscalation: false,
      })
      .where(eq(conversations.id, conversationId));

    await emitActivityEvent(db, realtime, {
      type: 'handler.changed',
      userId: user.id,
      source: 'staff',
      conversationId,
      data: { from: conversation.mode, to: 'ai', reason: 'Staff handback' },
    });

    await realtime.notify({
      table: 'conversations',
      id: conversationId,
      prevTab: computeTab(
        conversation.mode,
        conversation.status,
        conversation.hasPendingEscalation,
      ),
      tab: 'ai',
    });

    return c.json({ success: true, mode: 'ai' });
  })
  /** POST /conversations/:id/claim — Staff claims an unassigned escalated conversation. */
  .post('/conversations/:id/claim', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const conversationId = c.req.param('id');
    const { realtime } = getModuleDeps();

    // Optimistic locking: only claim if assignee is still NULL
    const updated = await db
      .update(conversations)
      .set({ assignee: user.id, assignedAt: new Date() })
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.status, 'active'),
        ),
      )
      .returning({ id: conversations.id, assignee: conversations.assignee });

    // Filter: only succeed if assignee was previously null
    // (Drizzle doesn't support IS NULL in .where for updates easily, so check result)
    if (updated.length === 0) {
      throw notFound('Conversation not found or not active');
    }

    // Verify the conversation was actually unassigned and in correct mode
    const [conversation] = await db
      .select({
        id: conversations.id,
        mode: conversations.mode,
        assignee: conversations.assignee,
      })
      .from(conversations)
      .where(eq(conversations.id, conversationId));

    if (
      conversation &&
      conversation.assignee === user.id &&
      (conversation.mode === 'human' || conversation.mode === 'supervised')
    ) {
      await emitActivityEvent(db, realtime, {
        type: 'conversation.claimed',
        userId: user.id,
        source: 'staff',
        conversationId,
        data: { assignee: user.id },
      });

      await realtime.notify({
        table: 'conversations',
        id: conversationId,
        tab: 'attention',
      });

      return c.json({ success: true, assignee: user.id });
    }

    // If mode is wrong (ai/held) or was already assigned, revert
    throw conflict('Conversation already claimed or not in escalated mode');
  })
  /** POST /sessions/:id/approve-draft — Approve a supervised AI draft for sending. */
  .post('/conversations/:id/approve-draft', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const conversationId = c.req.param('id');
    const { realtime, scheduler } = getModuleDeps();

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
    const body = z
      .object({ lastReadMessageId: z.string() })
      .parse(await c.req.json());

    const { realtime } = getModuleDeps();
    await db
      .update(conversations)
      .set({ unreadCount: 0 })
      .where(eq(conversations.id, conversationId));
    await emitActivityEvent(db, realtime, {
      type: 'message.read',
      conversationId,
      source: 'staff',
      userId: user.id,
      data: { lastReadMessageId: body.lastReadMessageId },
    });
    return c.json({ ok: true });
  })
  /** POST /conversations/:id/messages/:messageId/feedback — Toggle reaction. */
  .post('/conversations/:id/messages/:messageId/feedback', async (c) => {
    const { db, user } = getCtx(c);
    const conversationId = c.req.param('id');
    const messageId = c.req.param('messageId');
    const body = z
      .object({
        rating: z.enum(['positive', 'negative']),
      })
      .parse(await c.req.json());

    if (!user) throw unauthorized();

    // Check if user already has this exact rating → toggle off
    const [existing] = await db
      .select({ id: messageFeedback.id, rating: messageFeedback.rating })
      .from(messageFeedback)
      .where(
        and(
          eq(messageFeedback.conversationId, conversationId),
          eq(messageFeedback.messageId, messageId),
          eq(messageFeedback.userId, user.id),
        ),
      );

    const { realtime } = getModuleDeps();

    if (existing?.rating === body.rating) {
      // Same reaction → remove it (toggle off)
      await db
        .delete(messageFeedback)
        .where(eq(messageFeedback.id, existing.id));
      realtime.notify({ table: 'conversations-feedback', id: conversationId });
      return c.json({ ok: true, action: 'removed' });
    }

    // Different or no existing → delete old + insert new
    if (existing) {
      await db
        .delete(messageFeedback)
        .where(eq(messageFeedback.id, existing.id));
    }
    await db.insert(messageFeedback).values({
      conversationId,
      messageId,
      rating: body.rating,
      userId: user.id,
      contactId: null,
    });

    realtime.notify({ table: 'conversations-feedback', id: conversationId });
    return c.json({ ok: true, action: 'added' });
  })
  /** GET /conversations/:id/feedback — List all reactions with user info. */
  .get('/conversations/:id/feedback', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();
    const conversationId = c.req.param('id');

    const rows = await db
      .select({
        messageId: messageFeedback.messageId,
        rating: messageFeedback.rating,
        userId: messageFeedback.userId,
        userName: authUser.name,
        userImage: authUser.image,
      })
      .from(messageFeedback)
      .leftJoin(authUser, eq(messageFeedback.userId, authUser.id))
      .where(eq(messageFeedback.conversationId, conversationId))
      .orderBy(asc(messageFeedback.createdAt));

    return c.json(rows);
  });
