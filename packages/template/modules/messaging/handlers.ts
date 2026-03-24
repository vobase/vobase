import { toAISdkStream } from '@mastra/ai-sdk';
import { getCtx, notFound, requireRole, VobaseError } from '@vobase/core';
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type TextUIPart,
  type UIMessage,
} from 'ai';
import { and, count, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getAgent, listAgents } from '../../mastra/agents';
import { cleanupConversationMemory } from '../../mastra/processors/memory/cleanup';
import {
  createMemoryThread,
  deleteMemoryThread,
  loadConversationMessages,
  saveInboundMessage,
} from './lib/memory-bridge';
import {
  msgContactInboxes,
  msgContacts,
  msgConversationLabels,
  msgConversations,
  msgInboxes,
  msgLabels,
  msgOutbox,
  msgTeamMembers,
  msgTeams,
} from './schema';

/** Get the authenticated user's ID — throws if not authenticated (auth middleware guarantees this). */
function requireUserId(ctx: { user?: { id: string } | null }): string {
  if (!ctx.user) throw new Error('Authentication required');
  return ctx.user.id;
}

const createConversationSchema = z.object({
  title: z.string().nullable().optional(),
  agentId: z.string(),
});

const chatSchema = z.object({
  messages: z.array(
    z.object({
      id: z.string(),
      role: z.enum(['user', 'assistant', 'system']),
      parts: z.array(z.unknown()),
      createdAt: z.string().optional(),
    }),
  ),
});

const createContactSchema = z.object({
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  name: z.string().nullable().optional(),
  channel: z.string().optional(),
});

const sendMessageSchema = z.object({
  content: z.string().min(1),
});

const createInboxSchema = z.object({
  name: z.string().min(1).max(100),
  channel: z.enum(['whatsapp', 'web', 'email']),
  channelConfig: z.record(z.string(), z.unknown()).default({}),
  defaultAgentId: z.string().optional(),
  teamId: z.string().optional(),
  autoResolveIdleMinutes: z.number().int().min(0).default(120),
});

const updateInboxSchema = createInboxSchema.partial();

const createTeamSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
});

const addMemberSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['member', 'lead']).default('member'),
});

const createLabelSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().optional(),
});

const updateConversationSchema = z.object({
  status: z
    .enum(['open', 'pending', 'resolved', 'snoozed', 'closed'])
    .optional(),
  handler: z.enum(['ai', 'human', 'unassigned']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  assigneeId: z.string().nullable().optional(),
  teamId: z.string().nullable().optional(),
});

const assignConversationSchema = z.object({
  assigneeId: z.string().optional(),
  teamId: z.string().optional(),
});

export const messagingRoutes = new Hono();

// Agents (read-only — agents are defined in code, not the database)
messagingRoutes.get('/agents', async (c) => {
  const all = listAgents();
  const results = await Promise.all(
    all.map(async (a) => ({
      ...a.meta,
      instructions: (await a.agent.getInstructions()) ?? '',
    })),
  );
  return c.json(results);
});

messagingRoutes.get('/agents/:id', async (c) => {
  const registered = getAgent(c.req.param('id'));
  if (!registered) throw notFound('Agent not found');
  return c.json({
    ...registered.meta,
    instructions: (await registered.agent.getInstructions()) ?? '',
  });
});

// Conversations
messagingRoutes.post('/conversations', async (c) => {
  const ctx = getCtx(c);
  const body = createConversationSchema.parse(await c.req.json());
  if (!getAgent(body.agentId)) throw notFound('Agent not found');
  const userId = requireUserId(ctx);
  const [conversation] = await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .insert(msgConversations)
      .values({
        title: body.title,
        agentId: body.agentId,
        userId,
      })
      .returning();
    await ctx.realtime.notify(
      { table: 'messaging-conversations', id: rows[0].id, action: 'insert' },
      tx,
    );
    return rows;
  });

  // Create corresponding Memory thread (same ID for correlation)
  try {
    await createMemoryThread({
      threadId: conversation.id,
      resourceId: userId,
      title: body.title ?? undefined,
    });
  } catch (err) {
    // Memory not initialized — non-fatal for conversation creation
    console.warn('[messaging] createMemoryThread failed:', err);
  }

  return c.json(conversation, 201);
});

messagingRoutes.get('/conversations', async (c) => {
  const ctx = getCtx(c);
  const channelFilter = c.req.query('channel');
  const statusFilter = c.req.query('status');
  const handlerFilter = c.req.query('handler');
  const priorityFilter = c.req.query('priority');
  const inboxIdFilter = c.req.query('inboxId');
  const assigneeIdFilter = c.req.query('assigneeId');
  const teamIdFilter = c.req.query('teamId');
  const labelIdFilter = c.req.query('labelId');

  const filters: SQL[] = [eq(msgConversations.userId, requireUserId(ctx))];

  if (channelFilter && channelFilter !== 'all') {
    filters.push(eq(msgConversations.channel, channelFilter));
  }
  if (statusFilter) {
    filters.push(eq(msgConversations.status, statusFilter));
  }
  if (handlerFilter) {
    filters.push(eq(msgConversations.handler, handlerFilter));
  }
  if (priorityFilter) {
    filters.push(eq(msgConversations.priority, priorityFilter));
  }
  if (inboxIdFilter) {
    filters.push(eq(msgConversations.inboxId, inboxIdFilter));
  }
  if (assigneeIdFilter) {
    filters.push(eq(msgConversations.assigneeId, assigneeIdFilter));
  }
  if (teamIdFilter) {
    filters.push(eq(msgConversations.teamId, teamIdFilter));
  }

  // Label filter requires a subquery via inArray
  if (labelIdFilter) {
    const labelledIds = ctx.db
      .select({ conversationId: msgConversationLabels.conversationId })
      .from(msgConversationLabels)
      .where(eq(msgConversationLabels.labelId, labelIdFilter));

    filters.push(inArray(msgConversations.id, labelledIds));
  }

  const conversations = await ctx.db
    .select()
    .from(msgConversations)
    .where(and(...filters))
    .orderBy(desc(msgConversations.updatedAt));
  return c.json(conversations);
});

messagingRoutes.get('/conversations/:id', async (c) => {
  const ctx = getCtx(c);
  const conversation = (
    await ctx.db
      .select()
      .from(msgConversations)
      .where(
        and(
          eq(msgConversations.id, c.req.param('id')),
          eq(msgConversations.userId, requireUserId(ctx)),
        ),
      )
  )[0];
  if (!conversation) throw notFound('Conversation not found');

  // Load messages from Mastra Memory and transform to DbMessage format
  let messages: Array<{
    id: string;
    conversationId: string;
    aiRole: string;
    content: string;
    sources: string | null;
    toolCalls: string | null;
    createdAt: string;
  }> = [];
  try {
    const rawMessages = await loadConversationMessages(conversation.id);
    // biome-ignore lint/suspicious/noExplicitAny: Mastra Memory messages have no stable public TypeScript interface
    messages = (rawMessages as any[]).map((m: any) => ({
      id: m.id ?? '',
      conversationId: conversation.id,
      aiRole: m.role ?? 'user',
      content:
        typeof m.content === 'string'
          ? m.content
          : (m.content?.parts
              ?.filter((p: { type: string }) => p.type === 'text')
              .map((p: { text?: string }) => p.text ?? '')
              .join('') ?? ''),
      sources: null,
      toolCalls: null,
      createdAt:
        typeof m.createdAt === 'string'
          ? m.createdAt
          : m.createdAt instanceof Date
            ? m.createdAt.toISOString()
            : new Date().toISOString(),
    }));
  } catch (err) {
    // Memory not initialized — return conversation without messages
    console.warn('[messaging] loadConversationMessages failed:', err);
  }

  return c.json({ ...conversation, messages });
});

messagingRoutes.patch('/conversations/:id', async (c) => {
  const ctx = getCtx(c);
  const id = c.req.param('id');
  const body = updateConversationSchema.parse(await c.req.json());

  const existing = (
    await ctx.db
      .select()
      .from(msgConversations)
      .where(eq(msgConversations.id, id))
  )[0];
  if (!existing) throw notFound('Conversation');

  const [updated] = await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .update(msgConversations)
      .set(body)
      .where(eq(msgConversations.id, id))
      .returning();
    await ctx.realtime.notify(
      { table: 'messaging-conversations', id, action: 'update' },
      tx,
    );
    return rows;
  });

  return c.json(updated);
});

messagingRoutes.post('/conversations/:id/assign', async (c) => {
  const ctx = getCtx(c);
  const id = c.req.param('id');
  const body = assignConversationSchema.parse(await c.req.json());

  const existing = (
    await ctx.db
      .select()
      .from(msgConversations)
      .where(eq(msgConversations.id, id))
  )[0];
  if (!existing) throw notFound('Conversation');

  const updates: Record<string, unknown> = {};
  if (body.assigneeId !== undefined) updates.assigneeId = body.assigneeId;
  if (body.teamId !== undefined) updates.teamId = body.teamId;
  if (body.assigneeId) updates.handler = 'human';

  const [updated] = await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .update(msgConversations)
      .set(updates)
      .where(eq(msgConversations.id, id))
      .returning();
    await ctx.realtime.notify(
      { table: 'messaging-conversations', id, action: 'update' },
      tx,
    );
    return rows;
  });

  return c.json(updated);
});

messagingRoutes.delete('/conversations/:id', async (c) => {
  const ctx = getCtx(c);
  const id = c.req.param('id');
  const conversation = (
    await ctx.db
      .select()
      .from(msgConversations)
      .where(
        and(
          eq(msgConversations.id, id),
          eq(msgConversations.userId, requireUserId(ctx)),
        ),
      )
  )[0];
  if (!conversation) throw notFound('Conversation not found');

  // Delete memory data first (EverMemOS MemCells, Episodes, EventLogs)
  try {
    await cleanupConversationMemory(ctx.db, id);
  } catch (err) {
    console.warn(
      '[messaging] Memory cleanup failed during conversation delete:',
      err,
    );
  }

  // Delete Mastra Memory thread
  await deleteMemoryThread(id);

  // Transactional delete + notify (NOTIFY fires only on commit)
  await ctx.db.transaction(async (tx) => {
    await tx.delete(msgOutbox).where(eq(msgOutbox.conversationId, id));
    await tx.delete(msgConversations).where(eq(msgConversations.id, id));
    await ctx.realtime.notify(
      { table: 'messaging-conversations', id, action: 'delete' },
      tx,
    );
  });

  return c.json({ success: true });
});

// Chat endpoint — accepts UIMessage[] from useChat, returns UIMessageStreamResponse
messagingRoutes.post('/conversations/:id/chat', async (c) => {
  const ctx = getCtx(c);
  const conversationId = c.req.param('id');
  const { messages } = chatSchema.parse(await c.req.json());
  const { isAIConfigured } = await import('../../lib/ai');

  // Auto-set conversation title from first user message
  const conversation = (
    await ctx.db
      .select()
      .from(msgConversations)
      .where(eq(msgConversations.id, conversationId))
  )[0];
  if (!conversation) throw notFound('Conversation not found');

  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  const userText =
    lastUserMsg?.parts
      ?.filter(
        (p): p is TextUIPart =>
          typeof p === 'object' &&
          p !== null &&
          (p as TextUIPart).type === 'text',
      )
      .map((p) => p.text)
      .join('') ?? '';

  if (!conversation.title && userText) {
    await ctx.db
      .update(msgConversations)
      .set({ title: userText.slice(0, 100) })
      .where(eq(msgConversations.id, conversationId));
    await ctx.realtime.notify({
      table: 'messaging-conversations',
      id: conversationId,
      action: 'update',
    });
  }

  if (!conversation.agentId) {
    return c.json({ error: 'Conversation has no agent assigned.' }, 400);
  }

  if (!isAIConfigured()) {
    return c.json(
      {
        error:
          'AI is not configured. Set OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, or ANTHROPIC_API_KEY in your .env file.',
      },
      503,
    );
  }

  // Stream response using registered Mastra Agent with Memory auto-persistence
  // Messages are persisted by the agent's Memory processors — no manual INSERT needed
  let streamChat: typeof import('./lib/chat').streamChat;
  try {
    ({ streamChat } = await import('./lib/chat'));
  } catch {
    return c.json({ saved: true, aiAvailable: false }, 200);
  }
  const result = await streamChat({
    agentId: conversation.agentId,
    messages: messages as UIMessage[],
    conversation: {
      id: conversationId,
      contactId: conversation.contactId,
      userId: conversation.userId,
    },
  });

  // Convert Mastra stream to AI SDK UIMessageStream format
  const mastraStream = toAISdkStream(result, { from: 'agent', version: 'v6' });
  const stream = createUIMessageStream({
    originalMessages: messages as UIMessage[],
    execute: ({ writer }) => {
      writer.merge(mastraStream);
    },
  });
  return createUIMessageStreamResponse({ stream });
});

// Conversation Labels
messagingRoutes.get('/conversations/:id/labels', async (c) => {
  const ctx = getCtx(c);
  const conversationId = c.req.param('id');
  const rows = await ctx.db
    .select({
      labelId: msgConversationLabels.labelId,
      label: {
        id: msgLabels.id,
        name: msgLabels.name,
        color: msgLabels.color,
      },
    })
    .from(msgConversationLabels)
    .innerJoin(msgLabels, eq(msgConversationLabels.labelId, msgLabels.id))
    .where(eq(msgConversationLabels.conversationId, conversationId));
  return c.json(rows);
});

messagingRoutes.post('/conversations/:id/labels', async (c) => {
  const ctx = getCtx(c);
  const conversationId = c.req.param('id');
  const { labelId } = z
    .object({ labelId: z.string().min(1) })
    .parse(await c.req.json());

  const conversation = (
    await ctx.db
      .select()
      .from(msgConversations)
      .where(eq(msgConversations.id, conversationId))
  )[0];
  if (!conversation) throw notFound('Conversation');

  const label = (
    await ctx.db.select().from(msgLabels).where(eq(msgLabels.id, labelId))
  )[0];
  if (!label) throw notFound('Label');

  await ctx.db.transaction(async (tx) => {
    await tx
      .insert(msgConversationLabels)
      .values({ conversationId, labelId })
      .onConflictDoNothing();
    await ctx.realtime.notify(
      {
        table: 'messaging-conversations',
        id: conversationId,
        action: 'update',
      },
      tx,
    );
  });

  return c.json({ success: true }, 201);
});

messagingRoutes.delete('/conversations/:id/labels/:labelId', async (c) => {
  const ctx = getCtx(c);
  const conversationId = c.req.param('id');
  const labelId = c.req.param('labelId');

  await ctx.db.transaction(async (tx) => {
    await tx
      .delete(msgConversationLabels)
      .where(
        and(
          eq(msgConversationLabels.conversationId, conversationId),
          eq(msgConversationLabels.labelId, labelId),
        ),
      );
    await ctx.realtime.notify(
      {
        table: 'messaging-conversations',
        id: conversationId,
        action: 'update',
      },
      tx,
    );
  });

  return c.json({ success: true });
});

// Contacts
messagingRoutes.get('/contacts', async (c) => {
  const ctx = getCtx(c);
  const contacts = await ctx.db
    .select()
    .from(msgContacts)
    .orderBy(desc(msgContacts.updatedAt));
  return c.json(contacts);
});

messagingRoutes.get('/contacts/:id', async (c) => {
  const ctx = getCtx(c);
  const contact = (
    await ctx.db
      .select()
      .from(msgContacts)
      .where(eq(msgContacts.id, c.req.param('id')))
  )[0];
  if (!contact) throw notFound('Contact not found');
  const conversations = await ctx.db
    .select()
    .from(msgConversations)
    .where(eq(msgConversations.contactId, contact.id))
    .orderBy(desc(msgConversations.updatedAt));
  return c.json({ ...contact, conversations });
});

messagingRoutes.post('/contacts', async (c) => {
  const body = createContactSchema.parse(await c.req.json());
  const ctx = getCtx(c);
  const [contact] = await ctx.db
    .insert(msgContacts)
    .values({
      phone: body.phone ?? null,
      email: body.email ?? null,
      name: body.name ?? null,
      channel: body.channel ?? 'whatsapp',
    })
    .returning();

  await ctx.realtime.notify({
    table: 'messaging-contacts',
    id: contact.id,
    action: 'insert',
  });

  return c.json(contact, 201);
});

// Resume AI on a conversation
messagingRoutes.post('/conversations/:id/resume-ai', async (c) => {
  const ctx = getCtx(c);
  const conversationId = c.req.param('id');
  const conversation = (
    await ctx.db
      .select()
      .from(msgConversations)
      .where(eq(msgConversations.id, conversationId))
  )[0];
  if (!conversation) throw notFound('Conversation not found');

  const [updated] = await ctx.db
    .update(msgConversations)
    .set({
      status: 'open',
      handler: 'ai',
      aiPausedAt: null,
      aiResumeAt: null,
    })
    .where(eq(msgConversations.id, conversationId))
    .returning();
  return c.json(updated);
});

// Send outbound message via channel
messagingRoutes.post('/conversations/:id/send', async (c) => {
  const ctx = getCtx(c);
  const conversationId = c.req.param('id');
  const body = sendMessageSchema.parse(await c.req.json());

  const conversation = (
    await ctx.db
      .select()
      .from(msgConversations)
      .where(eq(msgConversations.id, conversationId))
  )[0];
  if (!conversation) throw notFound('Conversation not found');

  const { queueOutboundMessage } = await import('./lib/outbox');
  await queueOutboundMessage(
    ctx.db,
    ctx.scheduler,
    conversationId,
    body.content,
    conversation.channel,
  );

  return c.json({ success: true }, 201);
});

// ─── Inboxes (admin only) ─────────────────────────────────────────────

messagingRoutes.post('/inboxes', requireRole('admin'), async (c) => {
  const ctx = getCtx(c);
  const body = createInboxSchema.parse(await c.req.json());

  const [inbox] = await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .insert(msgInboxes)
      .values({
        name: body.name,
        channel: body.channel,
        channelConfig: body.channelConfig,
        defaultAgentId: body.defaultAgentId,
        teamId: body.teamId,
        autoResolveIdleMinutes: body.autoResolveIdleMinutes,
      })
      .returning();
    await ctx.realtime.notify(
      { table: 'messaging-inboxes', id: rows[0].id, action: 'insert' },
      tx,
    );
    return rows;
  });

  return c.json(inbox, 201);
});

messagingRoutes.get('/inboxes', async (c) => {
  const ctx = getCtx(c);
  const inboxes = await ctx.db
    .select()
    .from(msgInboxes)
    .orderBy(desc(msgInboxes.createdAt));
  return c.json(inboxes);
});

messagingRoutes.get('/inboxes/:id', async (c) => {
  const ctx = getCtx(c);
  const inbox = (
    await ctx.db
      .select()
      .from(msgInboxes)
      .where(eq(msgInboxes.id, c.req.param('id')))
  )[0];
  if (!inbox) throw notFound('Inbox');
  return c.json(inbox);
});

messagingRoutes.patch('/inboxes/:id', requireRole('admin'), async (c) => {
  const ctx = getCtx(c);
  const id = c.req.param('id');
  const body = updateInboxSchema.parse(await c.req.json());

  const existing = (
    await ctx.db.select().from(msgInboxes).where(eq(msgInboxes.id, id))
  )[0];
  if (!existing) throw notFound('Inbox');

  const [updated] = await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .update(msgInboxes)
      .set(body)
      .where(eq(msgInboxes.id, id))
      .returning();
    await ctx.realtime.notify(
      { table: 'messaging-inboxes', id, action: 'update' },
      tx,
    );
    return rows;
  });

  return c.json(updated);
});

messagingRoutes.delete('/inboxes/:id', requireRole('admin'), async (c) => {
  const ctx = getCtx(c);
  const id = c.req.param('id');

  const existing = (
    await ctx.db.select().from(msgInboxes).where(eq(msgInboxes.id, id))
  )[0];
  if (!existing) throw notFound('Inbox');

  // Block deletion if inbox has conversations
  const [{ value: convCount }] = await ctx.db
    .select({ value: count() })
    .from(msgConversations)
    .where(eq(msgConversations.inboxId, id));
  if (convCount > 0) {
    throw new VobaseError(
      `Cannot delete inbox with ${convCount} conversation(s). Reassign or delete them first.`,
      'CONFLICT',
      409,
    );
  }

  await ctx.db.transaction(async (tx) => {
    await tx.delete(msgInboxes).where(eq(msgInboxes.id, id));
    await ctx.realtime.notify(
      { table: 'messaging-inboxes', id, action: 'delete' },
      tx,
    );
  });

  return c.json({ success: true });
});

// ─── Teams (admin only) ───────────────────────────────────────────────

messagingRoutes.post('/teams', requireRole('admin'), async (c) => {
  const ctx = getCtx(c);
  const body = createTeamSchema.parse(await c.req.json());

  const [team] = await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .insert(msgTeams)
      .values({
        name: body.name,
        description: body.description,
      })
      .returning();
    await ctx.realtime.notify(
      { table: 'messaging-teams', id: rows[0].id, action: 'insert' },
      tx,
    );
    return rows;
  });

  return c.json(team, 201);
});

messagingRoutes.get('/teams', async (c) => {
  const ctx = getCtx(c);
  const teams = await ctx.db
    .select({
      id: msgTeams.id,
      name: msgTeams.name,
      description: msgTeams.description,
      createdAt: msgTeams.createdAt,
      updatedAt: msgTeams.updatedAt,
      memberCount: count(msgTeamMembers.id),
    })
    .from(msgTeams)
    .leftJoin(msgTeamMembers, eq(msgTeams.id, msgTeamMembers.teamId))
    .groupBy(
      msgTeams.id,
      msgTeams.name,
      msgTeams.description,
      msgTeams.createdAt,
      msgTeams.updatedAt,
    )
    .orderBy(desc(msgTeams.createdAt));
  return c.json(teams);
});

messagingRoutes.get('/teams/:id', async (c) => {
  const ctx = getCtx(c);
  const id = c.req.param('id');

  const team = (
    await ctx.db.select().from(msgTeams).where(eq(msgTeams.id, id))
  )[0];
  if (!team) throw notFound('Team');

  const members = await ctx.db
    .select()
    .from(msgTeamMembers)
    .where(eq(msgTeamMembers.teamId, id))
    .orderBy(desc(msgTeamMembers.createdAt));

  return c.json({ ...team, members });
});

messagingRoutes.patch('/teams/:id', requireRole('admin'), async (c) => {
  const ctx = getCtx(c);
  const id = c.req.param('id');
  const body = createTeamSchema.partial().parse(await c.req.json());

  const existing = (
    await ctx.db.select().from(msgTeams).where(eq(msgTeams.id, id))
  )[0];
  if (!existing) throw notFound('Team');

  const [updated] = await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .update(msgTeams)
      .set(body)
      .where(eq(msgTeams.id, id))
      .returning();
    await ctx.realtime.notify(
      { table: 'messaging-teams', id, action: 'update' },
      tx,
    );
    return rows;
  });

  return c.json(updated);
});

messagingRoutes.delete('/teams/:id', requireRole('admin'), async (c) => {
  const ctx = getCtx(c);
  const id = c.req.param('id');

  const existing = (
    await ctx.db.select().from(msgTeams).where(eq(msgTeams.id, id))
  )[0];
  if (!existing) throw notFound('Team');

  await ctx.db.transaction(async (tx) => {
    await tx.delete(msgTeams).where(eq(msgTeams.id, id));
    await ctx.realtime.notify(
      { table: 'messaging-teams', id, action: 'delete' },
      tx,
    );
  });

  return c.json({ success: true });
});

messagingRoutes.post('/teams/:id/members', requireRole('admin'), async (c) => {
  const ctx = getCtx(c);
  const teamId = c.req.param('id');
  const body = addMemberSchema.parse(await c.req.json());

  const team = (
    await ctx.db.select().from(msgTeams).where(eq(msgTeams.id, teamId))
  )[0];
  if (!team) throw notFound('Team');

  const [member] = await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .insert(msgTeamMembers)
      .values({
        teamId,
        userId: body.userId,
        role: body.role,
      })
      .returning();
    await ctx.realtime.notify(
      { table: 'messaging-teams', id: teamId, action: 'update' },
      tx,
    );
    return rows;
  });

  return c.json(member, 201);
});

messagingRoutes.delete(
  '/teams/:id/members/:userId',
  requireRole('admin'),
  async (c) => {
    const ctx = getCtx(c);
    const teamId = c.req.param('id');
    const userId = c.req.param('userId');

    const team = (
      await ctx.db.select().from(msgTeams).where(eq(msgTeams.id, teamId))
    )[0];
    if (!team) throw notFound('Team');

    const member = (
      await ctx.db
        .select()
        .from(msgTeamMembers)
        .where(
          and(
            eq(msgTeamMembers.teamId, teamId),
            eq(msgTeamMembers.userId, userId),
          ),
        )
    )[0];
    if (!member) throw notFound('Team member');

    await ctx.db.transaction(async (tx) => {
      await tx.delete(msgTeamMembers).where(eq(msgTeamMembers.id, member.id));
      await ctx.realtime.notify(
        { table: 'messaging-teams', id: teamId, action: 'update' },
        tx,
      );
    });

    return c.json({ success: true });
  },
);

// ─── Labels ───────────────────────────────────────────────────────────

messagingRoutes.post('/labels', async (c) => {
  const ctx = getCtx(c);
  const body = createLabelSchema.parse(await c.req.json());

  const [label] = await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .insert(msgLabels)
      .values({
        name: body.name,
        color: body.color,
      })
      .returning();
    await ctx.realtime.notify(
      { table: 'messaging-labels', id: rows[0].id, action: 'insert' },
      tx,
    );
    return rows;
  });

  return c.json(label, 201);
});

messagingRoutes.get('/labels', async (c) => {
  const ctx = getCtx(c);
  const labels = await ctx.db
    .select()
    .from(msgLabels)
    .orderBy(desc(msgLabels.createdAt));
  return c.json(labels);
});

messagingRoutes.delete('/labels/:id', async (c) => {
  const ctx = getCtx(c);
  const id = c.req.param('id');

  const existing = (
    await ctx.db.select().from(msgLabels).where(eq(msgLabels.id, id))
  )[0];
  if (!existing) throw notFound('Label');

  await ctx.db.transaction(async (tx) => {
    await tx.delete(msgLabels).where(eq(msgLabels.id, id));
    await ctx.realtime.notify(
      { table: 'messaging-labels', id, action: 'delete' },
      tx,
    );
  });

  return c.json({ success: true });
});

// ─── Contact Inboxes (for contact detail) ─────────────────────────────

messagingRoutes.get('/contacts/:id/inboxes', async (c) => {
  const ctx = getCtx(c);
  const contactId = c.req.param('id');

  const contact = (
    await ctx.db.select().from(msgContacts).where(eq(msgContacts.id, contactId))
  )[0];
  if (!contact) throw notFound('Contact');

  const contactInboxes = await ctx.db
    .select({
      id: msgContactInboxes.id,
      contactId: msgContactInboxes.contactId,
      inboxId: msgContactInboxes.inboxId,
      sourceId: msgContactInboxes.sourceId,
      createdAt: msgContactInboxes.createdAt,
      inboxName: msgInboxes.name,
      inboxChannel: msgInboxes.channel,
    })
    .from(msgContactInboxes)
    .leftJoin(msgInboxes, eq(msgContactInboxes.inboxId, msgInboxes.id))
    .where(eq(msgContactInboxes.contactId, contactId));

  return c.json(contactInboxes);
});

// ─── Public Chat Endpoints (no auth required) ─────────────────────────
// These endpoints allow unauthenticated visitors to chat via web inboxes.
// Rate limiting should be added via middleware in production.

const publicStartSchema = z.object({
  visitorToken: z.string().min(8).max(64),
});

const publicMessageSchema = z.object({
  visitorToken: z.string().min(8).max(64),
  content: z.string().min(1).max(4000),
});

// Start or resume a conversation as a visitor
messagingRoutes.post('/chat/:inboxId/start', async (c) => {
  const ctx = getCtx(c);
  const inboxId = c.req.param('inboxId');
  const body = publicStartSchema.parse(await c.req.json());

  // Look up inbox and verify it is enabled
  const inbox = (
    await ctx.db
      .select()
      .from(msgInboxes)
      .where(and(eq(msgInboxes.id, inboxId), eq(msgInboxes.enabled, true)))
  )[0];
  if (!inbox) throw notFound('Inbox');

  // Find or create contact by visitorToken
  let contact = (
    await ctx.db
      .select()
      .from(msgContacts)
      .where(eq(msgContacts.identifier, body.visitorToken))
  )[0];

  if (!contact) {
    const [created] = await ctx.db
      .insert(msgContacts)
      .values({
        identifier: body.visitorToken,
        channel: 'web',
      })
      .returning();
    contact = created;
  }

  // Find or create contactInbox
  const existingCI = (
    await ctx.db
      .select()
      .from(msgContactInboxes)
      .where(
        and(
          eq(msgContactInboxes.inboxId, inboxId),
          eq(msgContactInboxes.sourceId, body.visitorToken),
        ),
      )
  )[0];

  if (!existingCI) {
    await ctx.db.insert(msgContactInboxes).values({
      contactId: contact.id,
      inboxId,
      sourceId: body.visitorToken,
    });
  }

  // Find existing open conversation or create new one
  let conversation = (
    await ctx.db
      .select()
      .from(msgConversations)
      .where(
        and(
          eq(msgConversations.contactId, contact.id),
          eq(msgConversations.inboxId, inboxId),
          eq(msgConversations.status, 'open'),
        ),
      )
      .orderBy(desc(msgConversations.createdAt))
      .limit(1)
  )[0];

  if (!conversation) {
    const [created] = await ctx.db
      .insert(msgConversations)
      .values({
        contactId: contact.id,
        inboxId,
        channel: 'web',
        handler: 'ai',
        agentId: inbox.defaultAgentId,
        teamId: inbox.teamId,
      })
      .returning();
    conversation = created;

    // Create corresponding Memory thread
    try {
      await createMemoryThread({
        threadId: conversation.id,
        resourceId: contact.id,
      });
    } catch (err) {
      console.warn('[messaging] public chat createMemoryThread failed:', err);
    }
  }

  return c.json({
    conversationId: conversation.id,
    agentId: conversation.agentId,
  });
});

// Send message as visitor
messagingRoutes.post('/chat/:inboxId/messages', async (c) => {
  const ctx = getCtx(c);
  const inboxId = c.req.param('inboxId');
  const body = publicMessageSchema.parse(await c.req.json());

  // Find contact by visitorToken
  const contact = (
    await ctx.db
      .select()
      .from(msgContacts)
      .where(eq(msgContacts.identifier, body.visitorToken))
  )[0];
  if (!contact) throw notFound('Contact');

  // Find conversation
  const conversation = (
    await ctx.db
      .select()
      .from(msgConversations)
      .where(
        and(
          eq(msgConversations.contactId, contact.id),
          eq(msgConversations.inboxId, inboxId),
          eq(msgConversations.status, 'open'),
        ),
      )
      .orderBy(desc(msgConversations.createdAt))
      .limit(1)
  )[0];
  if (!conversation) throw notFound('Conversation');

  // Save message to Mastra Memory
  try {
    await saveInboundMessage({
      threadId: conversation.id,
      resourceId: contact.id,
      content: body.content,
      role: 'user',
    });
  } catch (err) {
    console.warn('[messaging] public chat saveInboundMessage failed:', err);
  }

  // Auto-set title from first message
  if (!conversation.title) {
    await ctx.db
      .update(msgConversations)
      .set({ title: body.content.slice(0, 100) })
      .where(eq(msgConversations.id, conversation.id));
  }

  return c.json({ success: true, conversationId: conversation.id });
});

// Public chat streaming endpoint — AI response for visitor messages
messagingRoutes.post('/chat/:inboxId/stream', async (c) => {
  const ctx = getCtx(c);
  const inboxId = c.req.param('inboxId');
  const { messages } = chatSchema.parse(await c.req.json());
  const visitorToken = c.req.query('visitorToken');
  if (!visitorToken) return c.json({ error: 'visitorToken required' }, 400);

  // Find contact
  const contact = (
    await ctx.db
      .select()
      .from(msgContacts)
      .where(eq(msgContacts.identifier, visitorToken))
  )[0];
  if (!contact) throw notFound('Contact');

  // Find conversation
  const conversation = (
    await ctx.db
      .select()
      .from(msgConversations)
      .where(
        and(
          eq(msgConversations.contactId, contact.id),
          eq(msgConversations.inboxId, inboxId),
          eq(msgConversations.status, 'open'),
        ),
      )
      .orderBy(desc(msgConversations.createdAt))
      .limit(1)
  )[0];
  if (!conversation) throw notFound('Conversation');
  if (!conversation.agentId) return c.json({ error: 'No agent assigned' }, 400);

  const { isAIConfigured } = await import('../../lib/ai');
  if (!isAIConfigured()) {
    return c.json({ error: 'AI is not configured' }, 503);
  }

  let streamChat: typeof import('./lib/chat').streamChat;
  try {
    ({ streamChat } = await import('./lib/chat'));
  } catch {
    return c.json({ error: 'Chat not available' }, 503);
  }

  const result = await streamChat({
    agentId: conversation.agentId,
    messages: messages as UIMessage[],
    conversation: {
      id: conversation.id,
      contactId: conversation.contactId,
    },
  });

  const mastraStream = toAISdkStream(result, { from: 'agent', version: 'v6' });
  const stream = createUIMessageStream({
    originalMessages: messages as UIMessage[],
    execute: ({ writer }) => {
      writer.merge(mastraStream);
    },
  });
  return createUIMessageStreamResponse({ stream });
});

// Get conversation messages as visitor
messagingRoutes.get('/chat/:inboxId/conversations/:id', async (c) => {
  const ctx = getCtx(c);
  const conversationId = c.req.param('id');
  const visitorToken = c.req.query('visitorToken');
  if (!visitorToken) return c.json({ error: 'visitorToken required' }, 400);

  // Find contact and verify ownership
  const contact = (
    await ctx.db
      .select()
      .from(msgContacts)
      .where(eq(msgContacts.identifier, visitorToken))
  )[0];
  if (!contact) throw notFound('Contact');

  const conversation = (
    await ctx.db
      .select()
      .from(msgConversations)
      .where(
        and(
          eq(msgConversations.id, conversationId),
          eq(msgConversations.contactId, contact.id),
        ),
      )
  )[0];
  if (!conversation) throw notFound('Conversation');

  // Load messages from Mastra Memory
  // biome-ignore lint/suspicious/noExplicitAny: Mastra Memory messages have no stable public TypeScript interface
  let messages: any[] = [];
  try {
    const rawMessages = await loadConversationMessages(conversation.id);
    // biome-ignore lint/suspicious/noExplicitAny: Mastra Memory messages have no stable public TypeScript interface
    messages = (rawMessages as any[]).map((m: any) => ({
      id: m.id ?? '',
      conversationId: conversation.id,
      role: m.role ?? 'user',
      content:
        typeof m.content === 'string'
          ? m.content
          : (m.content?.parts
              ?.filter((p: { type: string }) => p.type === 'text')
              .map((p: { text?: string }) => p.text ?? '')
              .join('') ?? ''),
      createdAt:
        typeof m.createdAt === 'string'
          ? m.createdAt
          : m.createdAt instanceof Date
            ? m.createdAt.toISOString()
            : new Date().toISOString(),
    }));
  } catch (err) {
    console.warn('[messaging] public loadConversationMessages failed:', err);
  }

  return c.json({ ...conversation, messages });
});
