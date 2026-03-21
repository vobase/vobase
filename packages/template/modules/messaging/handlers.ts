import { toAISdkStream } from '@mastra/ai-sdk';
import { getCtx, notFound } from '@vobase/core';
import {
  createUIMessageStreamResponse,
  type TextUIPart,
  type UIMessage,
} from 'ai';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { cleanupThreadMemory } from '../ai/lib/memory/cleanup';
import { msgAgents, msgContacts, msgMessages, msgThreads } from './schema';

/** Get the authenticated user's ID — throws if not authenticated (auth middleware guarantees this). */
function requireUserId(ctx: { user?: { id: string } | null }): string {
  if (!ctx.user) throw new Error('Authentication required');
  return ctx.user.id;
}

const createAgentSchema = z.object({
  name: z.string().min(1),
  avatar: z.string().nullable().optional(),
  systemPrompt: z.string().nullable().optional(),
  tools: z.array(z.string()).nullable().optional(),
  kbSourceIds: z.array(z.string()).nullable().optional(),
  model: z.string().nullable().optional(),
  channels: z.array(z.string()).nullable().optional(),
  isPublished: z.boolean().optional(),
});

const updateAgentSchema = createAgentSchema.partial();

const createThreadSchema = z.object({
  title: z.string().nullable().optional(),
  agentId: z.string(),
});

const createMessageSchema = z.object({
  direction: z.enum(['inbound', 'outbound']).optional(),
  senderType: z.enum(['user', 'agent', 'contact', 'staff']).optional(),
  aiRole: z.enum(['user', 'assistant']).optional(),
  content: z.string(),
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

// Agents CRUD
messagingRoutes.post('/agents', async (c) => {
  const ctx = getCtx(c);
  const body = createAgentSchema.parse(await c.req.json());
  const [agent] = await ctx.db
    .insert(msgAgents)
    .values({
      name: body.name,
      avatar: body.avatar,
      systemPrompt: body.systemPrompt,
      tools: body.tools ? JSON.stringify(body.tools) : null,
      kbSourceIds: body.kbSourceIds ? JSON.stringify(body.kbSourceIds) : null,
      model: body.model,
      channels: body.channels ? JSON.stringify(body.channels) : null,
      userId: requireUserId(ctx),
      isPublished: body.isPublished ?? false,
    })
    .returning();
  return c.json(agent, 201);
});

messagingRoutes.get('/agents', async (c) => {
  const ctx = getCtx(c);
  const agents = await ctx.db
    .select()
    .from(msgAgents)
    .where(eq(msgAgents.userId, requireUserId(ctx)))
    .orderBy(desc(msgAgents.createdAt));
  return c.json(agents);
});

messagingRoutes.get('/agents/:id', async (c) => {
  const ctx = getCtx(c);
  const agent = (
    await ctx.db
      .select()
      .from(msgAgents)
      .where(eq(msgAgents.id, c.req.param('id')))
  )[0];
  if (!agent) throw notFound('Agent not found');
  return c.json(agent);
});

messagingRoutes.put('/agents/:id', async (c) => {
  const ctx = getCtx(c);
  const body = updateAgentSchema.parse(await c.req.json());
  const [agent] = await ctx.db
    .update(msgAgents)
    .set({
      name: body.name,
      avatar: body.avatar,
      systemPrompt: body.systemPrompt,
      tools: body.tools ? JSON.stringify(body.tools) : undefined,
      kbSourceIds: body.kbSourceIds
        ? JSON.stringify(body.kbSourceIds)
        : undefined,
      model: body.model,
      channels: body.channels ? JSON.stringify(body.channels) : undefined,
      isPublished: body.isPublished,
    })
    .where(
      and(
        eq(msgAgents.id, c.req.param('id')),
        eq(msgAgents.userId, requireUserId(ctx)),
      ),
    )
    .returning();
  if (!agent) throw notFound('Agent not found');
  return c.json(agent);
});

messagingRoutes.delete('/agents/:id', async (c) => {
  const ctx = getCtx(c);
  await ctx.db
    .delete(msgAgents)
    .where(
      and(
        eq(msgAgents.id, c.req.param('id')),
        eq(msgAgents.userId, requireUserId(ctx)),
      ),
    );
  return c.json({ success: true });
});

// Threads
messagingRoutes.post('/threads', async (c) => {
  const ctx = getCtx(c);
  const body = createThreadSchema.parse(await c.req.json());
  const [thread] = await ctx.db
    .insert(msgThreads)
    .values({
      title: body.title,
      agentId: body.agentId,
      userId: requireUserId(ctx),
    })
    .returning();
  return c.json(thread, 201);
});

messagingRoutes.get('/threads', async (c) => {
  const ctx = getCtx(c);
  const channelFilter = c.req.query('channel');

  // Show user's own threads, optionally filtered by channel
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
  const messages = await ctx.db
    .select()
    .from(msgMessages)
    .where(eq(msgMessages.threadId, thread.id))
    .orderBy(msgMessages.createdAt);
  return c.json({ ...thread, messages });
});

messagingRoutes.delete('/threads/:id', async (c) => {
  const ctx = getCtx(c);
  const id = c.req.param('id');
  // Verify ownership before deleting
  const thread = (
    await ctx.db
      .select()
      .from(msgThreads)
      .where(
        and(eq(msgThreads.id, id), eq(msgThreads.userId, requireUserId(ctx))),
      )
  )[0];
  if (!thread) throw notFound('Thread not found');
  // Delete memory data first (reverse dependency order).
  // Wrapped in try-catch: memory tables may not exist in test/dev environments.
  try {
    await cleanupThreadMemory(ctx.db, id);
  } catch (err) {
    // Memory tables may not be pushed yet — log but don't block deletion
    console.warn(
      '[messaging] Memory cleanup failed during thread delete:',
      err,
    );
  }
  await ctx.db.delete(msgMessages).where(eq(msgMessages.threadId, id));
  await ctx.db.delete(msgThreads).where(eq(msgThreads.id, id));
  return c.json({ success: true });
});

// Legacy endpoint — save a single message (used by seed/tests)
messagingRoutes.post('/threads/:id/messages', async (c) => {
  const ctx = getCtx(c);
  const threadId = c.req.param('id');
  const body = createMessageSchema.parse(await c.req.json());
  await ctx.db.insert(msgMessages).values({
    threadId,
    direction: body.direction ?? 'inbound',
    senderType: body.senderType ?? 'user',
    aiRole: body.aiRole ?? (body.senderType === 'agent' ? 'assistant' : 'user'),
    content: body.content,
  });
  return c.json({ success: true }, 201);
});

// Chat endpoint — accepts UIMessage[] from useChat, returns UIMessageStreamResponse
messagingRoutes.post('/threads/:id/chat', async (c) => {
  const ctx = getCtx(c);
  const threadId = c.req.param('id');
  const { messages } = chatSchema.parse(await c.req.json());
  const { isAIConfigured } = await import('../../lib/ai');

  // Extract latest user message text for DB persistence
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

  // Save user message to DB
  if (userText) {
    await ctx.db.insert(msgMessages).values({
      threadId,
      direction: 'inbound',
      senderType: 'user',
      aiRole: 'user',
      content: userText,
    });
  }

  // Auto-set thread title from first user message
  const thread = (
    await ctx.db.select().from(msgThreads).where(eq(msgThreads.id, threadId))
  )[0];
  if (!thread) throw notFound('Thread not found');

  if (!thread.title && userText) {
    await ctx.db
      .update(msgThreads)
      .set({ title: userText.slice(0, 100) })
      .where(eq(msgThreads.id, threadId));
  }

  if (!thread.agentId) {
    return c.json({ error: 'Thread has no agent assigned.' }, 400);
  }

  // If AI not configured, return error as JSON
  if (!isAIConfigured()) {
    return c.json(
      {
        error:
          'AI is not configured. Set OPENAI_API_KEY, GEMINI_API_KEY, or ANTHROPIC_API_KEY in your .env file.',
      },
      503,
    );
  }

  // Stream response using Mastra Agent → AI SDK stream bridge
  let streamChat: typeof import('./lib/chat').streamChat;
  try {
    ({ streamChat } = await import('./lib/chat'));
  } catch {
    // ai module not available — message already saved, return without AI reply
    return c.json({ saved: true, aiAvailable: false }, 200);
  }
  const result = await streamChat({
    db: ctx.db,
    scheduler: ctx.scheduler,
    agentId: thread.agentId,
    messages: messages as UIMessage[],
    thread: {
      id: threadId,
      contactId: thread.contactId,
      userId: thread.userId,
    },
  });

  // Save assistant response to DB in background
  Promise.resolve(result.text)
    .then(async (text) => {
      await ctx.db.insert(msgMessages).values({
        threadId,
        direction: 'outbound',
        senderType: 'agent',
        aiRole: 'assistant',
        content: text,
      });
    })
    .catch((err) => {
      console.error(
        `[messaging] Failed to persist assistant response for thread ${threadId}:`,
        err,
      );
    });

  // Convert Mastra stream to AI SDK UIMessageStream format
  const stream = toAISdkStream(result, { from: 'agent', version: 'v6' });
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
