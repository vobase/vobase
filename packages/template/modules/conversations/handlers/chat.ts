import { toAISdkStream } from '@mastra/ai-sdk';
import type { VobaseDb } from '@vobase/core';
import { getCtx, notFound, unauthorized } from '@vobase/core';
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getMemory } from '../../../mastra';
import { getAgent } from '../../../mastra/agents';
import { contacts } from '../../contacts/schema';
import { streamChat } from '../lib/chat-stream';
import { createSession } from '../lib/session';
import { channelInstances, endpoints, sessions } from '../schema';

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

const startSchema = z.object({
  visitorToken: z.string().min(1),
});

/**
 * Upsert a visitor contact by their token. Returns the contact ID.
 * Uses the identifier field to store the visitor token for lookup.
 */
async function upsertVisitorContact(
  db: VobaseDb,
  visitorToken: string,
): Promise<string> {
  const [existing] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.identifier, `visitor:${visitorToken}`));

  if (existing) return existing.id;

  const [created] = await db
    .insert(contacts)
    .values({
      identifier: `visitor:${visitorToken}`,
      name: 'Visitor',
      role: 'customer',
    })
    .returning({ id: contacts.id });

  return created.id;
}

export const chatHandlers = new Hono()
  /** POST /chat — Web chat: stream agent response. Creates session if needed. */
  .post('/chat', async (c) => {
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
    const stream = toAISdkStream(result, { from: 'agent', version: 'v6' });

    return new Response(stream as unknown as BodyInit, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Session-Id': sessionId,
      },
    });
  })
  /** POST /chat/:endpointId/start — Start or resume a public chat session. */
  .post('/chat/:endpointId/start', async (c) => {
    const { db, scheduler } = getCtx(c);
    const endpointId = c.req.param('endpointId');
    const body = startSchema.parse(await c.req.json());

    // Look up endpoint
    const [endpoint] = await db
      .select()
      .from(endpoints)
      .where(and(eq(endpoints.id, endpointId), eq(endpoints.enabled, true)));

    if (!endpoint) throw notFound('Endpoint not found');

    // Look up channel instance
    const [instance] = await db
      .select()
      .from(channelInstances)
      .where(eq(channelInstances.id, endpoint.channelInstanceId));

    if (!instance) throw notFound('Channel instance not found');

    // Upsert visitor contact
    const contactId = await upsertVisitorContact(db, body.visitorToken);

    // Check for existing active session for this visitor + endpoint
    const [existingSession] = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.endpointId, endpointId),
          eq(sessions.contactId, contactId),
          eq(sessions.status, 'active'),
        ),
      );

    if (existingSession) {
      return c.json({
        conversationId: existingSession.id,
        agentId: existingSession.agentId,
      });
    }

    // Create new session
    const session = await createSession(
      { db, scheduler },
      {
        endpointId: endpoint.id,
        contactId,
        agentId: endpoint.agentId,
        channelInstanceId: endpoint.channelInstanceId,
      },
    );

    return c.json({
      conversationId: session.id,
      agentId: session.agentId,
    });
  })
  /** GET /chat/:endpointId/conversations/:conversationId — Load message history. */
  .get('/chat/:endpointId/conversations/:conversationId', async (c) => {
    const { db } = getCtx(c);
    const endpointId = c.req.param('endpointId');
    const conversationId = c.req.param('conversationId');
    const visitorToken = c.req.query('visitorToken') ?? '';

    if (!visitorToken) throw unauthorized();

    // Verify the session belongs to this endpoint and visitor
    const [session] = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.id, conversationId),
          eq(sessions.endpointId, endpointId),
        ),
      );

    if (!session) throw notFound('Conversation not found');

    // Verify visitor owns this session
    const [contact] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.identifier, `visitor:${visitorToken}`));

    if (!contact || contact.id !== session.contactId) throw unauthorized();

    // Load messages from Mastra Memory
    try {
      const memory = getMemory();
      const result = await memory.recall({ threadId: conversationId });
      const messages = (result?.messages ?? []).map((m) => {
        // Mastra v2 stores content as { format: 2, parts: [...], content: "text" }
        const raw = m.content as unknown;
        let parts: Array<{
          type: string;
          text?: string;
          [key: string]: unknown;
        }>;

        if (
          typeof raw === 'object' &&
          raw !== null &&
          'format' in raw &&
          'parts' in raw
        ) {
          const v2 = raw as { parts: typeof parts; content?: string };
          parts = v2.parts;
        } else if (typeof raw === 'string') {
          parts = [{ type: 'text', text: raw }];
        } else if (Array.isArray(raw)) {
          parts = raw;
        } else {
          parts = [{ type: 'text', text: '' }];
        }

        return {
          id: m.id,
          role: m.role,
          parts,
          createdAt: m.createdAt ?? new Date().toISOString(),
        };
      });

      return c.json({
        id: session.id,
        title: null,
        agentId: session.agentId,
        messages,
      });
    } catch {
      // Memory unavailable — return empty
      return c.json({
        id: session.id,
        title: null,
        agentId: session.agentId,
        messages: [],
      });
    }
  })
  /** POST /chat/:endpointId/stream — Stream agent response for public chat. */
  .post('/chat/:endpointId/stream', async (c) => {
    const { db } = getCtx(c);
    const endpointId = c.req.param('endpointId');
    const visitorToken =
      new URL(c.req.url).searchParams.get('visitorToken') ?? '';

    if (!visitorToken) throw unauthorized();

    // Verify visitor
    const [contact] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.identifier, `visitor:${visitorToken}`));

    if (!contact) throw unauthorized();

    // Find the active session for this visitor + endpoint
    const [session] = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.endpointId, endpointId),
          eq(sessions.contactId, contact.id),
          eq(sessions.status, 'active'),
        ),
      );

    if (!session) throw notFound('No active session');

    // Parse the AI SDK request body — extract last user message
    // AI SDK v6 sends { parts: [{ type: 'text', text }] }, v5 sends { content }
    const body = await c.req.json();
    const bodyMessages = body.messages ?? [];
    const lastUserRaw = bodyMessages.findLast(
      (m: { role: string }) => m.role === 'user',
    );
    let lastUserMsg = '';
    if (lastUserRaw) {
      if (typeof lastUserRaw.content === 'string') {
        lastUserMsg = lastUserRaw.content;
      } else if (Array.isArray(lastUserRaw.parts)) {
        lastUserMsg = lastUserRaw.parts
          .filter((p: { type: string }) => p.type === 'text')
          .map((p: { text: string }) => p.text)
          .join('');
      }
    }

    // Stream via Mastra agent with memory (auto-persists messages)
    const result = await streamChat({
      sessionId: session.id,
      message: typeof lastUserMsg === 'string' ? lastUserMsg : '',
      agentId: session.agentId,
      resourceId: `contact:${contact.id}`,
    });

    // Bridge Mastra stream to AI SDK v6 UIMessageStream format
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        for await (const part of toAISdkStream(result, {
          from: 'agent',
          version: 'v6',
        })) {
          writer.write(part);
        }
      },
    });

    return createUIMessageStreamResponse({ stream });
  });
