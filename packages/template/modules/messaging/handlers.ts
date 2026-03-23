import { toAISdkStream } from '@mastra/ai-sdk';
import { getCtx, notFound } from '@vobase/core';
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type TextUIPart,
  type UIMessage,
} from 'ai';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getAgent, listAgents } from '../../mastra/agents';
import { cleanupThreadMemory } from '../../mastra/processors/memory/cleanup';
import {
  createMemoryThread,
  deleteMemoryThread,
  loadThreadMessages,
} from './lib/memory-bridge';
import { msgContacts, msgOutbox, msgThreads } from './schema';

/** Get the authenticated user's ID — throws if not authenticated (auth middleware guarantees this). */
function requireUserId(ctx: { user?: { id: string } | null }): string {
  if (!ctx.user) throw new Error('Authentication required');
  return ctx.user.id;
}

const createThreadSchema = z.object({
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

// Threads
messagingRoutes.post('/threads', async (c) => {
  const ctx = getCtx(c);
  const body = createThreadSchema.parse(await c.req.json());
  if (!getAgent(body.agentId)) throw notFound('Agent not found');
  const userId = requireUserId(ctx);
  const [thread] = await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .insert(msgThreads)
      .values({
        title: body.title,
        agentId: body.agentId,
        userId,
      })
      .returning();
    await ctx.realtime.notify(
      { table: 'messaging-threads', id: rows[0].id, action: 'insert' },
      tx,
    );
    return rows;
  });

  // Create corresponding Memory thread (same ID for correlation)
  try {
    await createMemoryThread({
      threadId: thread.id,
      resourceId: userId,
      title: body.title ?? undefined,
    });
  } catch (err) {
    // Memory not initialized — non-fatal for thread creation
    console.warn('[messaging] createMemoryThread failed:', err);
  }

  return c.json(thread, 201);
});

messagingRoutes.get('/threads', async (c) => {
  const ctx = getCtx(c);
  const channelFilter = c.req.query('channel');

  const conditions =
    channelFilter && channelFilter !== 'all'
      ? and(
          eq(msgThreads.userId, requireUserId(ctx)),
          eq(msgThreads.channel, channelFilter),
        )
      : eq(msgThreads.userId, requireUserId(ctx));

  const threads = await ctx.db
    .select()
    .from(msgThreads)
    .where(conditions)
    .orderBy(desc(msgThreads.updatedAt));
  return c.json(threads);
});

messagingRoutes.get('/threads/:id', async (c) => {
  const ctx = getCtx(c);
  const thread = (
    await ctx.db
      .select()
      .from(msgThreads)
      .where(
        and(
          eq(msgThreads.id, c.req.param('id')),
          eq(msgThreads.userId, requireUserId(ctx)),
        ),
      )
  )[0];
  if (!thread) throw notFound('Thread not found');

  // Load messages from Mastra Memory and transform to DbMessage format
  let messages: Array<{
    id: string;
    threadId: string;
    aiRole: string;
    content: string;
    sources: string | null;
    toolCalls: string | null;
    createdAt: string;
  }> = [];
  try {
    const rawMessages = await loadThreadMessages(thread.id);
    // biome-ignore lint/suspicious/noExplicitAny: Mastra Memory messages have no stable public TypeScript interface
    messages = (rawMessages as any[]).map((m: any) => ({
      id: m.id ?? '',
      threadId: thread.id,
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
    // Memory not initialized — return thread without messages
    console.warn('[messaging] loadThreadMessages failed:', err);
  }

  return c.json({ ...thread, messages });
});

messagingRoutes.delete('/threads/:id', async (c) => {
  const ctx = getCtx(c);
  const id = c.req.param('id');
  const thread = (
    await ctx.db
      .select()
      .from(msgThreads)
      .where(
        and(eq(msgThreads.id, id), eq(msgThreads.userId, requireUserId(ctx))),
      )
  )[0];
  if (!thread) throw notFound('Thread not found');

  // Delete memory data first (EverMemOS MemCells, Episodes, EventLogs)
  try {
    await cleanupThreadMemory(ctx.db, id);
  } catch (err) {
    console.warn(
      '[messaging] Memory cleanup failed during thread delete:',
      err,
    );
  }

  // Delete Mastra Memory thread
  await deleteMemoryThread(id);

  // Transactional delete + notify (NOTIFY fires only on commit)
  await ctx.db.transaction(async (tx) => {
    await tx.delete(msgOutbox).where(eq(msgOutbox.threadId, id));
    await tx.delete(msgThreads).where(eq(msgThreads.id, id));
    await ctx.realtime.notify(
      { table: 'messaging-threads', id, action: 'delete' },
      tx,
    );
  });

  return c.json({ success: true });
});

// Chat endpoint — accepts UIMessage[] from useChat, returns UIMessageStreamResponse
messagingRoutes.post('/threads/:id/chat', async (c) => {
  const ctx = getCtx(c);
  const threadId = c.req.param('id');
  const { messages } = chatSchema.parse(await c.req.json());
  const { isAIConfigured } = await import('../../lib/ai');

  // Auto-set thread title from first user message
  const thread = (
    await ctx.db.select().from(msgThreads).where(eq(msgThreads.id, threadId))
  )[0];
  if (!thread) throw notFound('Thread not found');

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

  if (!thread.title && userText) {
    await ctx.db
      .update(msgThreads)
      .set({ title: userText.slice(0, 100) })
      .where(eq(msgThreads.id, threadId));
    await ctx.realtime.notify({
      table: 'messaging-threads',
      id: threadId,
      action: 'update',
    });
  }

  if (!thread.agentId) {
    return c.json({ error: 'Thread has no agent assigned.' }, 400);
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
    agentId: thread.agentId,
    messages: messages as UIMessage[],
    thread: {
      id: threadId,
      contactId: thread.contactId,
      userId: thread.userId,
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
  const threads = await ctx.db
    .select()
    .from(msgThreads)
    .where(eq(msgThreads.contactId, contact.id))
    .orderBy(desc(msgThreads.updatedAt));
  return c.json({ ...contact, threads });
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

// Resume AI on a thread
messagingRoutes.post('/threads/:id/resume-ai', async (c) => {
  const ctx = getCtx(c);
  const threadId = c.req.param('id');
  const thread = (
    await ctx.db.select().from(msgThreads).where(eq(msgThreads.id, threadId))
  )[0];
  if (!thread) throw notFound('Thread not found');

  const [updated] = await ctx.db
    .update(msgThreads)
    .set({
      status: 'ai',
      aiPausedAt: null,
      aiResumeAt: null,
    })
    .where(eq(msgThreads.id, threadId))
    .returning();
  return c.json(updated);
});

// Send outbound message via channel
messagingRoutes.post('/threads/:id/send', async (c) => {
  const ctx = getCtx(c);
  const threadId = c.req.param('id');
  const body = sendMessageSchema.parse(await c.req.json());

  const thread = (
    await ctx.db.select().from(msgThreads).where(eq(msgThreads.id, threadId))
  )[0];
  if (!thread) throw notFound('Thread not found');

  const { queueOutboundMessage } = await import('./lib/outbox');
  await queueOutboundMessage(
    ctx.db,
    ctx.scheduler,
    threadId,
    body.content,
    thread.channel,
  );

  return c.json({ success: true }, 201);
});
