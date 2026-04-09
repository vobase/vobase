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

import { enqueueDelivery } from '../lib/delivery';
import { getModuleDeps } from '../lib/deps';
import { failInteraction, resolveInteraction } from '../lib/interaction';
import { withdrawMessageSchema } from '../lib/message-types';
import { insertMessage } from '../lib/messages';
import { transition } from '../lib/state-machine';
import {
  channelInstances,
  consultations,
  contactLabels,
  contacts,
  interactions,
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

/** Urgency rank for picking the representative interaction per contact. Lower = more urgent. */
function urgencyRank(row: {
  hasPendingEscalation: boolean;
  mode: string;
}): number {
  if (row.hasPendingEscalation) return 0;
  if (row.mode === 'held') return 1;
  if (row.mode === 'human') return 2;
  if (row.mode === 'supervised') return 3;
  return 4;
}

/** Get qualifying contact IDs for a tab using Drizzle query builder. */
async function getTabContactIds(
  db: VobaseDb,
  tab: 'attention' | 'active' | 'done',
): Promise<string[]> {
  if (tab === 'attention') {
    const rows = await db
      .selectDistinct({ contactId: interactions.contactId })
      .from(interactions)
      .where(
        and(
          eq(interactions.status, 'active'),
          or(
            inArray(interactions.mode, ['human', 'supervised', 'held']),
            eq(interactions.hasPendingEscalation, true),
          ),
        ),
      );
    return rows.map((r) => r.contactId);
  }

  if (tab === 'active') {
    // First get attention contact IDs to exclude
    const attentionRows = await db
      .selectDistinct({ contactId: interactions.contactId })
      .from(interactions)
      .where(
        and(
          eq(interactions.status, 'active'),
          or(
            inArray(interactions.mode, ['human', 'supervised', 'held']),
            eq(interactions.hasPendingEscalation, true),
          ),
        ),
      );
    const attentionIds = new Set(attentionRows.map((r) => r.contactId));

    const activeRows = await db
      .selectDistinct({ contactId: interactions.contactId })
      .from(interactions)
      .where(eq(interactions.status, 'active'));
    return activeRows
      .map((r) => r.contactId)
      .filter((id) => !attentionIds.has(id));
  }

  // Done: contacts where NO non-terminal interaction exists
  const nonTerminalRows = await db
    .selectDistinct({ contactId: interactions.contactId })
    .from(interactions)
    .where(sql`${interactions.status} NOT IN ('resolved', 'failed')`);
  const nonTerminalIds = new Set(nonTerminalRows.map((r) => r.contactId));

  const allContactRows = await db
    .selectDistinct({ contactId: interactions.contactId })
    .from(interactions);
  return allContactRows
    .map((r) => r.contactId)
    .filter((id) => !nonTerminalIds.has(id));
}

/** Build contact-level aggregated rows for a tab using Drizzle query builder. */
async function buildContactRows(
  db: VobaseDb,
  tab: 'attention' | 'active' | 'done',
  limit: number,
  offset: number,
) {
  const contactIds = await getTabContactIds(db, tab);
  if (contactIds.length === 0) return [];

  // Run aggregation, representative, channels, and contact queries in parallel
  const [aggRows, reprRows, channelRows, contactRows] = await Promise.all([
    // Aggregated interaction data per contact
    db
      .select({
        contactId: interactions.contactId,
        unreadCount: sql<number>`sum(${interactions.unreadCount})::int`,
        lastMessageAt: sql<Date | null>`max(${interactions.lastMessageAt})`,
        hasPendingEscalation: sql<boolean>`bool_or(${interactions.hasPendingEscalation})`,
        waitingSince: sql<Date | null>`min(${interactions.waitingSince})`,
      })
      .from(interactions)
      .where(inArray(interactions.contactId, contactIds))
      .groupBy(interactions.contactId),

    // All candidate interactions for picking representative per contact
    db
      .select({
        contactId: interactions.contactId,
        status: interactions.status,
        mode: interactions.mode,
        priority: interactions.priority,
        lastMessageContent: interactions.lastMessageContent,
        lastMessageType: interactions.lastMessageType,
        hasPendingEscalation: interactions.hasPendingEscalation,
        resolvedAt: interactions.resolvedAt,
        waitingSince: interactions.waitingSince,
      })
      .from(interactions)
      .where(
        and(
          inArray(interactions.contactId, contactIds),
          tab === 'done'
            ? inArray(interactions.status, ['resolved', 'failed'])
            : eq(interactions.status, 'active'),
        ),
      ),

    // Distinct channel types per contact
    db
      .selectDistinct({
        contactId: interactions.contactId,
        channelType: channelInstances.type,
      })
      .from(interactions)
      .innerJoin(
        channelInstances,
        eq(interactions.channelInstanceId, channelInstances.id),
      )
      .where(inArray(interactions.contactId, contactIds)),

    // Contact details
    db.select().from(contacts).where(inArray(contacts.id, contactIds)),
  ]);

  // Pick highest-urgency representative interaction per contact
  const reprMap = new Map<string, (typeof reprRows)[0]>();
  for (const row of reprRows) {
    const existing = reprMap.get(row.contactId);
    if (!existing || urgencyRank(row) < urgencyRank(existing)) {
      reprMap.set(row.contactId, row);
    }
  }

  // Build channel arrays per contact
  const channelMap = new Map<string, string[]>();
  for (const row of channelRows) {
    const arr = channelMap.get(row.contactId) ?? [];
    arr.push(row.channelType);
    channelMap.set(row.contactId, arr);
  }

  // Build aggregation map
  const aggMap = new Map<string, (typeof aggRows)[0]>();
  for (const row of aggRows) {
    aggMap.set(row.contactId, row);
  }

  // Merge everything into contact rows
  const merged = contactRows.map((c) => {
    const agg = aggMap.get(c.id);
    const repr = reprMap.get(c.id);
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      role: c.role,
      channels: channelMap.get(c.id) ?? [],
      status: repr?.status ?? 'resolved',
      mode: repr?.mode ?? 'ai',
      priority: repr?.priority ?? null,
      unreadCount: agg?.unreadCount ?? 0,
      lastMessageContent: repr?.lastMessageContent ?? null,
      lastMessageAt: agg?.lastMessageAt ?? null,
      lastMessageType: repr?.lastMessageType ?? null,
      hasPendingEscalation: agg?.hasPendingEscalation ?? false,
      waitingSince: agg?.waitingSince ?? null,
    };
  });

  // Sort: attention by waitingSince ASC, others by lastMessageAt DESC
  merged.sort((a, b) => {
    if (tab === 'attention') {
      const aTime = a.waitingSince?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bTime = b.waitingSince?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    }
    const aTime = a.lastMessageAt?.getTime() ?? 0;
    const bTime = b.lastMessageAt?.getTime() ?? 0;
    return bTime - aTime;
  });

  return merged.slice(offset, offset + limit);
}

const updateInteractionSchema = z.object({
  status: z.enum(['resolved', 'failed']).optional(),
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
  replyToMessageId: z.string().optional(),
  cc: z.array(z.string().email()).optional(),
  subject: z.string().optional(),
});

export const interactionsDetailHandlers = new Hono()
  /** GET /interactions — List interactions with filters and pagination. */
  .get('/interactions', async (c) => {
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
    if (agentId) conditions.push(eq(interactions.agentId, agentId));
    if (contactId) conditions.push(eq(interactions.contactId, contactId));
    if (status) conditions.push(eq(interactions.status, status));
    if (channelInstanceId)
      conditions.push(eq(interactions.channelInstanceId, channelInstanceId));

    const rows = await db
      .select()
      .from(interactions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(interactions.createdAt))
      .limit(limit)
      .offset(offset);

    return c.json(rows);
  })

  /** GET /interactions/mine — Interactions assigned to the current user. */
  .get('/interactions/mine', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const { limit, offset } = paginationSchema.parse({
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
    });

    const rows = await db
      .select({
        id: interactions.id,
        status: interactions.status,
        mode: interactions.mode,
        assignee: interactions.assignee,
        assignedAt: interactions.assignedAt,
        priority: interactions.priority,
        contactId: interactions.contactId,
        contactName: contacts.name,
        agentId: interactions.agentId,
        channelInstanceId: interactions.channelInstanceId,
        createdAt: interactions.createdAt,
        updatedAt: interactions.updatedAt,
        lastMessageContent: interactions.lastMessageContent,
        lastMessageAt: interactions.lastMessageAt,
        lastMessageType: interactions.lastMessageType,
      })
      .from(interactions)
      .leftJoin(contacts, eq(interactions.contactId, contacts.id))
      .where(
        and(
          eq(interactions.assignee, user.id),
          eq(interactions.status, 'active'),
        ),
      )
      .orderBy(
        sql`CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`,
        asc(interactions.assignedAt),
      )
      .limit(limit)
      .offset(offset);

    return c.json(rows);
  })
  /** GET /interactions/queue — Unassigned escalated interactions waiting to be claimed. */
  .get('/interactions/queue', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const { limit, offset } = paginationSchema.parse({
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
    });

    const rows = await db
      .select({
        id: interactions.id,
        status: interactions.status,
        mode: interactions.mode,
        priority: interactions.priority,
        contactId: interactions.contactId,
        contactName: contacts.name,
        agentId: interactions.agentId,
        channelInstanceId: interactions.channelInstanceId,
        createdAt: interactions.createdAt,
        updatedAt: interactions.updatedAt,
        lastMessageContent: interactions.lastMessageContent,
        lastMessageAt: interactions.lastMessageAt,
        lastMessageType: interactions.lastMessageType,
      })
      .from(interactions)
      .leftJoin(contacts, eq(interactions.contactId, contacts.id))
      .where(
        and(
          sql`${interactions.assignee} IS NULL`,
          inArray(interactions.mode, ['human', 'supervised']),
          eq(interactions.status, 'active'),
        ),
      )
      .orderBy(
        sql`CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`,
        asc(interactions.createdAt),
      )
      .limit(limit)
      .offset(offset);

    return c.json(rows);
  })
  /** GET /interactions/attention — Attention tab: contacts with human/supervised/held or pending escalation. */
  .get('/interactions/attention', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const { limit, offset } = paginationSchema.parse({
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
    });

    const rows = await buildContactRows(db, 'attention', limit, offset);
    return c.json(await withContactLabels(db, rows));
  })
  /** GET /interactions/active — Active tab: contacts with active AI interactions not in Attention. */
  .get('/interactions/active', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const { limit, offset } = paginationSchema.parse({
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
    });

    const rows = await buildContactRows(db, 'active', limit, offset);
    return c.json(await withContactLabels(db, rows));
  })
  /** GET /interactions/ai-active — Legacy alias for /active. */
  .get('/interactions/ai-active', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const { limit, offset } = paginationSchema.parse({
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
    });

    const rows = await buildContactRows(db, 'active', limit, offset);
    return c.json(await withContactLabels(db, rows));
  })
  /** GET /interactions/resolved — Done tab: contacts where all interactions are terminal. */
  .get('/interactions/resolved', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const { limit, offset } = paginationSchema.parse({
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
    });

    const rows = await buildContactRows(db, 'done', limit, offset);
    return c.json(await withContactLabels(db, rows));
  })
  /** GET /interactions/counts — Contact-level badge counts for all three tabs. */
  .get('/interactions/counts', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const [attentionIds, activeIds, doneIds] = await Promise.all([
      getTabContactIds(db, 'attention'),
      getTabContactIds(db, 'active'),
      getTabContactIds(db, 'done'),
    ]);

    return c.json({
      attention: attentionIds.length,
      active: activeIds.length,
      done: doneIds.length,
    });
  })
  /** GET /interactions/:id — Interaction detail. */
  .get('/interactions/:id', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const [interaction] = await db
      .select()
      .from(interactions)
      .where(eq(interactions.id, c.req.param('id')));

    if (!interaction) throw notFound('Interaction not found');

    return c.json(interaction);
  })
  /** GET /interactions/:id/messages — Load messages with cursor pagination. */
  .get(
    '/interactions/:id/messages',
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

      const interactionId = c.req.param('id');
      const { limit, before } = c.req.valid('query');

      const [interaction] = await db
        .select()
        .from(interactions)
        .where(eq(interactions.id, interactionId));

      if (!interaction) throw notFound('Interaction not found');

      const conditions = [eq(messages.interactionId, interactionId)];
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
   * GET /interactions/:id/timeline-messages — Unified timeline: all messages
   * for the same contact + channel across ALL interactions.
   */
  .get(
    '/interactions/:id/timeline-messages',
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

      const interactionId = c.req.param('id');
      const { limit, before } = c.req.valid('query');

      // 1. Get the anchor interaction to find contactId + channelInstanceId
      const [anchor] = await db
        .select({
          contactId: interactions.contactId,
          channelInstanceId: interactions.channelInstanceId,
        })
        .from(interactions)
        .where(eq(interactions.id, interactionId));

      if (!anchor) throw notFound('Interaction not found');

      // 2. Get all interactions for this contact + channel (for boundary metadata)
      const siblingInteractions = await db
        .select({
          id: interactions.id,
          status: interactions.status,
          outcome: interactions.outcome,
          startedAt: interactions.startedAt,
          resolvedAt: interactions.resolvedAt,
          reopenCount: interactions.reopenCount,
          mode: interactions.mode,
        })
        .from(interactions)
        .where(
          and(
            eq(interactions.contactId, anchor.contactId),
            eq(interactions.channelInstanceId, anchor.channelInstanceId),
          ),
        )
        .orderBy(asc(interactions.startedAt));

      const siblingIds = siblingInteractions.map((i) => i.id);

      // 3. Fetch messages across all sibling interactions with cursor pagination
      const conditions = [inArray(messages.interactionId, siblingIds)];
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
        interactions: siblingInteractions.map((i) => ({
          ...i,
          startedAt: i.startedAt.toISOString(),
          resolvedAt: i.resolvedAt?.toISOString() ?? null,
        })),
        currentInteractionId: interactionId,
      });
    },
  )
  /** PATCH /interactions/:id — Update interaction status. */
  .patch('/interactions/:id', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const body = updateInteractionSchema.parse(await c.req.json());
    const interactionId = c.req.param('id');

    const [existing] = await db
      .select()
      .from(interactions)
      .where(eq(interactions.id, interactionId));

    if (!existing) throw notFound('Interaction not found');

    const { realtime } = getModuleDeps();
    const deps = { db, realtime };

    // status → terminal state: resolve or fail, then return immediately
    if (body.status === 'resolved' || body.status === 'failed') {
      if (body.status === 'resolved') {
        await resolveInteraction(db, interactionId, realtime);
      } else {
        await failInteraction(
          db,
          interactionId,
          'Manually failed by user',
          realtime,
        );
      }
      const [updated] = await db
        .select()
        .from(interactions)
        .where(eq(interactions.id, interactionId));
      return c.json(updated);
    }

    // mode change → machine (only when assignee is not being set; ASSIGN handles mode atomically)
    if (body.mode && body.assignee === undefined) {
      const modeResult = await transition(deps, interactionId, {
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
        ? await transition(deps, interactionId, {
            type: 'ASSIGN',
            assignee: body.assignee,
            userId: user.id,
          })
        : await transition(deps, interactionId, {
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
        .update(interactions)
        .set({ priority: body.priority })
        .where(eq(interactions.id, interactionId));
    }

    const [updated] = await db
      .select()
      .from(interactions)
      .where(eq(interactions.id, interactionId));

    return c.json(updated);
  })
  /** POST /interactions/:id/reply — Human agent reply: insert message + enqueue delivery. */
  .post('/interactions/:id/reply', async (c) => {
    const { db, user, scheduler, realtime } = getCtx(c);
    if (!user) throw unauthorized();

    const body = replySchema.parse(await c.req.json());
    const interactionId = c.req.param('id');

    const [interaction] = await db
      .select({
        id: interactions.id,
        status: interactions.status,
        contactId: interactions.contactId,
        channelInstanceId: interactions.channelInstanceId,
      })
      .from(interactions)
      .where(eq(interactions.id, interactionId));

    if (!interaction) throw notFound('Interaction not found');

    if (interaction.status !== 'active') {
      throw notFound('Interaction is not active');
    }

    let channelType = 'web';
    if (interaction.channelInstanceId) {
      const [instance] = await db
        .select({ id: channelInstances.id, type: channelInstances.type })
        .from(channelInstances)
        .where(eq(channelInstances.id, interaction.channelInstanceId));
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
      interactionId,
      messageType: 'outgoing',
      contentType: 'text',
      content,
      contentData: Object.keys(contentData).length > 0 ? contentData : undefined,
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
  /** GET /interactions/:id/consultations — List consultations for an interaction. */
  .get('/interactions/:id/consultations', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const interactionId = c.req.param('id');

    const [interaction] = await db
      .select({ id: interactions.id })
      .from(interactions)
      .where(eq(interactions.id, interactionId));

    if (!interaction) throw notFound('Interaction not found');

    const rows = await db
      .select({
        id: consultations.id,
        interactionId: consultations.interactionId,
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
      .where(eq(consultations.interactionId, interactionId))
      .orderBy(desc(consultations.createdAt));

    return c.json(rows);
  })
  /** POST /interactions/:id/handback — Return interaction from human to AI mode. */
  .post('/interactions/:id/handback', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const interactionId = c.req.param('id');
    const { realtime } = getModuleDeps();

    const result = await transition({ db, realtime }, interactionId, {
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
  /** POST /interactions/:id/claim — Staff claims an unassigned escalated interaction. */
  .post('/interactions/:id/claim', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const interactionId = c.req.param('id');
    const { realtime } = getModuleDeps();

    const result = await transition({ db, realtime }, interactionId, {
      type: 'CLAIM',
      userId: user.id,
    });

    if (!result.ok) {
      if (
        result.code === 'CONCURRENCY_CONFLICT' ||
        result.code === 'GUARD_FAILED'
      ) {
        throw conflict('Interaction already claimed or not available');
      }
      throw notFound('Interaction not found or not active');
    }

    return c.json({ success: true, assignee: user.id });
  })
  /** POST /interactions/:id/approve-draft — Approve a supervised AI draft for sending. */
  .post('/interactions/:id/approve-draft', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const interactionId = c.req.param('id');
    const { realtime, scheduler } = getModuleDeps();

    // Find pending draft activity message
    const [draft] = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.interactionId, interactionId),
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
        interactionId,
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
  /** POST /interactions/:id/typing — Staff signals typing (fire-and-forget NOTIFY). */
  .post('/interactions/:id/typing', async (c) => {
    const { user } = getCtx(c);
    if (!user) throw unauthorized();
    const interactionId = c.req.param('id');
    const { realtime } = getModuleDeps();
    await realtime.notify({
      table: 'interactions-typing',
      id: interactionId,
      action: `${user.id}:${user.name ?? user.email}`,
    });
    return c.json({ ok: true });
  })
  /** POST /interactions/:id/read — Mark interaction as read by current user. */
  .post('/interactions/:id/read', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();
    const interactionId = c.req.param('id');

    const { realtime } = getModuleDeps();
    await db
      .update(interactions)
      .set({ unreadCount: 0, agentLastSeenAt: new Date() })
      .where(eq(interactions.id, interactionId));
    await realtime
      .notify({ table: 'interactions', id: interactionId, action: 'update' })
      .catch(() => {});
    return c.json({ ok: true });
  })
  /** POST /interactions/:id/messages/:messageId/feedback — Toggle reaction or add feedback message. */
  .post('/interactions/:id/messages/:messageId/feedback', async (c) => {
    const { db, user } = getCtx(c);
    const interactionId = c.req.param('id');
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
        interactionId,
        messageId,
        rating: body.rating,
        reason: body.reason,
        userId: user.id,
        contactId: null,
      });
      realtime.notify({ table: 'interactions-feedback', id: interactionId });
      return c.json({ ok: true, action: 'added' });
    }

    // Reaction (no reason) — unique per user per message, toggle
    const action = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: messageFeedback.id, rating: messageFeedback.rating })
        .from(messageFeedback)
        .where(
          and(
            eq(messageFeedback.interactionId, interactionId),
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
        interactionId,
        messageId,
        rating: body.rating,
        reason: null,
        userId: user.id,
        contactId: null,
      });
      return 'added' as const;
    });

    realtime.notify({ table: 'interactions-feedback', id: interactionId });
    return c.json({ ok: true, action });
  })
  /** DELETE /interactions/:id/messages/:messageId/feedback/:feedbackId — Remove a feedback entry. */
  .delete(
    '/interactions/:id/messages/:messageId/feedback/:feedbackId',
    async (c) => {
      const { db, user } = getCtx(c);
      if (!user) throw unauthorized();
      const interactionId = c.req.param('id');
      const feedbackId = c.req.param('feedbackId');

      await db
        .delete(messageFeedback)
        .where(
          and(
            eq(messageFeedback.id, feedbackId),
            eq(messageFeedback.interactionId, interactionId),
            eq(messageFeedback.userId, user.id),
          ),
        );

      const { realtime } = getModuleDeps();
      realtime.notify({ table: 'interactions-feedback', id: interactionId });
      return c.json({ ok: true, action: 'removed' });
    },
  )
  /** GET /interactions/:id/feedback — List all reactions with user info. */
  .get('/interactions/:id/feedback', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();
    const interactionId = c.req.param('id');

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
      .where(eq(messageFeedback.interactionId, interactionId))
      .orderBy(asc(messageFeedback.createdAt));

    return c.json(rows);
  })
  /** POST /interactions/:id/messages/:mid/retry — Retry delivery of a failed message. */
  .post('/interactions/:id/messages/:mid/retry', async (c) => {
    const { db, user, scheduler } = getCtx(c);
    if (!user) throw unauthorized();

    const messageId = c.req.param('mid');
    const [message] = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.id, messageId),
          eq(messages.interactionId, c.req.param('id')),
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
  /** PATCH /interactions/:id/messages/:mid — Withdraw a message. */
  .patch('/interactions/:id/messages/:mid', async (c) => {
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
          eq(messages.interactionId, c.req.param('id')),
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
