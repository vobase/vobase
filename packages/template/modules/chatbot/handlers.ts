import { Hono } from 'hono';
import { getCtx, notFound } from '@vobase/core';
import { eq, desc, and } from 'drizzle-orm';
import { chatAssistants, chatThreads, chatMessages } from './schema';

export const chatbotRoutes = new Hono();

// Assistants CRUD
chatbotRoutes.post('/assistants', async (c) => {
  const ctx = getCtx(c);
  const body = await c.req.json();
  const [assistant] = await ctx.db.insert(chatAssistants).values({
    name: body.name,
    avatar: body.avatar,
    systemPrompt: body.systemPrompt,
    tools: body.tools ? JSON.stringify(body.tools) : null,
    kbSourceIds: body.kbSourceIds ? JSON.stringify(body.kbSourceIds) : null,
    model: body.model,
    userId: ctx.user!.id,
    isPublished: body.isPublished ?? false,
  }).returning();
  return c.json(assistant, 201);
});

chatbotRoutes.get('/assistants', async (c) => {
  const ctx = getCtx(c);
  const assistants = await ctx.db.select().from(chatAssistants)
    .where(eq(chatAssistants.userId, ctx.user!.id))
    .orderBy(desc(chatAssistants.createdAt));
  return c.json(assistants);
});

chatbotRoutes.get('/assistants/:id', async (c) => {
  const ctx = getCtx(c);
  const assistant = await ctx.db.select().from(chatAssistants)
    .where(eq(chatAssistants.id, c.req.param('id'))).get();
  if (!assistant) throw notFound('Assistant not found');
  return c.json(assistant);
});

chatbotRoutes.put('/assistants/:id', async (c) => {
  const ctx = getCtx(c);
  const body = await c.req.json();
  const [assistant] = await ctx.db.update(chatAssistants)
    .set({
      name: body.name,
      avatar: body.avatar,
      systemPrompt: body.systemPrompt,
      tools: body.tools ? JSON.stringify(body.tools) : undefined,
      kbSourceIds: body.kbSourceIds ? JSON.stringify(body.kbSourceIds) : undefined,
      model: body.model,
      isPublished: body.isPublished,
    })
    .where(and(eq(chatAssistants.id, c.req.param('id')), eq(chatAssistants.userId, ctx.user!.id)))
    .returning();
  if (!assistant) throw notFound('Assistant not found');
  return c.json(assistant);
});

chatbotRoutes.delete('/assistants/:id', async (c) => {
  const ctx = getCtx(c);
  await ctx.db.delete(chatAssistants)
    .where(and(eq(chatAssistants.id, c.req.param('id')), eq(chatAssistants.userId, ctx.user!.id)));
  return c.json({ success: true });
});

// Threads
chatbotRoutes.post('/threads', async (c) => {
  const ctx = getCtx(c);
  const body = await c.req.json();
  const [thread] = await ctx.db.insert(chatThreads).values({
    title: body.title,
    assistantId: body.assistantId,
    userId: ctx.user!.id,
  }).returning();
  return c.json(thread, 201);
});

chatbotRoutes.get('/threads', async (c) => {
  const ctx = getCtx(c);
  const threads = await ctx.db.select().from(chatThreads)
    .where(eq(chatThreads.userId, ctx.user!.id))
    .orderBy(desc(chatThreads.updatedAt));
  return c.json(threads);
});

chatbotRoutes.get('/threads/:id', async (c) => {
  const ctx = getCtx(c);
  const thread = await ctx.db.select().from(chatThreads)
    .where(and(eq(chatThreads.id, c.req.param('id')), eq(chatThreads.userId, ctx.user!.id))).get();
  if (!thread) throw notFound('Thread not found');
  const messages = await ctx.db.select().from(chatMessages)
    .where(eq(chatMessages.threadId, thread.id))
    .orderBy(chatMessages.createdAt);
  return c.json({ ...thread, messages });
});

chatbotRoutes.delete('/threads/:id', async (c) => {
  const ctx = getCtx(c);
  const id = c.req.param('id');
  // Verify ownership before deleting
  const thread = await ctx.db.select().from(chatThreads)
    .where(and(eq(chatThreads.id, id), eq(chatThreads.userId, ctx.user!.id))).get();
  if (!thread) throw notFound('Thread not found');
  await ctx.db.delete(chatMessages).where(eq(chatMessages.threadId, id));
  await ctx.db.delete(chatThreads).where(eq(chatThreads.id, id));
  return c.json({ success: true });
});

chatbotRoutes.post('/threads/:id/messages', async (c) => {
  const ctx = getCtx(c);
  const threadId = c.req.param('id');
  const body = await c.req.json();
  const { isAIConfigured } = await import('../../lib/ai');

  // Save user message
  await ctx.db.insert(chatMessages).values({
    threadId,
    role: 'user',
    content: body.content,
    attachments: body.attachments ? JSON.stringify(body.attachments) : null,
  });

  // If AI not configured, return a helpful message
  if (!isAIConfigured()) {
    const [msg] = await ctx.db
      .insert(chatMessages)
      .values({
        threadId,
        role: 'assistant',
        content:
          'AI is not configured. Please set an API key (OPENAI_API_KEY, GEMINI_API_KEY, or ANTHROPIC_API_KEY) in your .env file.',
      })
      .returning();
    return c.json(msg);
  }

  // Get thread to find assistant
  const thread = await ctx.db
    .select()
    .from(chatThreads)
    .where(eq(chatThreads.id, threadId))
    .get();
  if (!thread) throw notFound('Thread not found');

  // Stream response
  const { streamChat } = await import('./lib/chat');
  const result = await streamChat({
    db: ctx.db,
    threadId,
    assistantId: thread.assistantId,
    userMessage: body.content,
  });

  // Use toTextStreamResponse for streaming to the client
  const response = result.toTextStreamResponse();

  // Save the final message in the background
  Promise.resolve(result.text)
    .then(async (text) => {
      await ctx.db.insert(chatMessages).values({
        threadId,
        role: 'assistant',
        content: text,
      });
    })
    .catch(console.error);

  return response;
});
