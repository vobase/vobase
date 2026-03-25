import { toAISdkStream } from '@mastra/ai-sdk';
import { getCtx, notFound, unauthorized } from '@vobase/core';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getAgent } from '../../../mastra/agents';
import { streamChat } from '../lib/chat-stream';
import { createSession } from '../lib/session';
import { channelInstances, endpoints } from '../schema';

const chatSchema = z.object({
  sessionId: z.string().optional(),
  agentId: z.string().min(1),
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant', 'system']),
      content: z.string(),
    }),
  ),
});

export const chatHandlers = new Hono();

/** POST /chat — Web chat: stream agent response. Creates session if needed. */
chatHandlers.post('/chat', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const body = chatSchema.parse(await c.req.json());

  // Validate agent exists
  const registered = getAgent(body.agentId);
  if (!registered) throw notFound('Agent not found');

  // Resolve or create session
  let sessionId = body.sessionId;
  if (!sessionId) {
    // Find or create a web endpoint for this agent
    // First, find the web channel_instance
    const [webInstance] = await db
      .select()
      .from(channelInstances)
      .where(
        and(
          eq(channelInstances.type, 'web'),
          eq(channelInstances.status, 'active'),
        ),
      );

    if (!webInstance) throw notFound('No web channel instance configured');

    let [endpoint] = await db
      .select()
      .from(endpoints)
      .where(
        and(
          eq(endpoints.channelInstanceId, webInstance.id),
          eq(endpoints.agentId, body.agentId),
          eq(endpoints.enabled, true),
        ),
      );

    if (!endpoint) {
      [endpoint] = await db
        .insert(endpoints)
        .values({
          name: `${registered.meta.name} - Web`,
          channelInstanceId: webInstance.id,
          agentId: body.agentId,
          assignmentPattern: 'direct',
        })
        .returning();
    }

    const { scheduler } = getCtx(c);
    const session = await createSession(
      { db, scheduler },
      {
        endpointId: endpoint.id,
        contactId: user.id,
        agentId: body.agentId,
        channelInstanceId: webInstance.id,
      },
    );
    sessionId = session.id;
  }

  // Extract last user message for streaming
  const lastUserMessage =
    body.messages.findLast((m) => m.role === 'user')?.content ?? '';

  // Stream response
  const result = await streamChat({
    sessionId,
    message: lastUserMessage,
    agentId: body.agentId,
    resourceId: `user:${user.id}`,
  });

  // Bridge Mastra stream to AI SDK SSE format
  const stream = toAISdkStream(result, { from: 'agent' });

  return new Response(stream as unknown as BodyInit, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Session-Id': sessionId,
    },
  });
});
