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
import { completeConversation, createConversation } from '../lib/conversation';
import { channelInstances, channelRoutings, conversations } from '../schema';

const chatSchema = z.object({
  conversationId: z.string().optional(),
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

const resetSchema = z.object({
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
  /** POST /chat — Web chat: stream agent response. Creates conversation if needed. */
  .post('/chat', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const body = chatSchema.parse(await c.req.json());

    // Validate agent exists
    const registered = getAgent(body.agentId);
    if (!registered) throw notFound('Agent not found');

    // Resolve or create conversation
    let conversationId = body.conversationId;
    if (!conversationId) {
      // Find or create a web channel routing for this agent
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

      let [channelRouting] = await db
        .select()
        .from(channelRoutings)
        .where(
          and(
            eq(channelRoutings.channelInstanceId, webInstance.id),
            eq(channelRoutings.agentId, body.agentId),
            eq(channelRoutings.enabled, true),
          ),
        );

      if (!channelRouting) {
        [channelRouting] = await db
          .insert(channelRoutings)
          .values({
            name: `${registered.meta.name} - Web`,
            channelInstanceId: webInstance.id,
            agentId: body.agentId,
            assignmentPattern: 'direct',
          })
          .returning();
      }

      const { scheduler, realtime } = getCtx(c);
      const conversation = await createConversation(
        { db, scheduler, realtime },
        {
          channelRoutingId: channelRouting.id,
          contactId: user.id,
          agentId: body.agentId,
          channelInstanceId: webInstance.id,
        },
      );
      conversationId = conversation.id;
    }

    // Check handler mode for web chat
    if (conversationId) {
      const [conversationCheck] = await db
        .select({ handler: conversations.handler })
        .from(conversations)
        .where(eq(conversations.id, conversationId));

      if (
        conversationCheck?.handler === 'human' ||
        conversationCheck?.handler === 'paused'
      ) {
        return c.json(
          {
            error:
              'Conversation is in human/paused mode — AI responses are disabled',
          },
          403,
        );
      }
    }

    // Extract last user message for streaming
    const lastUserMessage =
      body.messages.findLast((m) => m.role === 'user')?.content ?? '';

    // Stream response
    const result = await streamChat({
      conversationId: conversationId,
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
        'X-Conversation-Id': conversationId,
      },
    });
  })
  /** POST /chat/:channelRoutingId/start — Start or resume a public chat conversation. */
  .post('/chat/:channelRoutingId/start', async (c) => {
    const { db, scheduler, realtime } = getCtx(c);
    const channelRoutingId = c.req.param('channelRoutingId');
    const body = startSchema.parse(await c.req.json());

    // Look up channel routing
    const [channelRouting] = await db
      .select()
      .from(channelRoutings)
      .where(
        and(
          eq(channelRoutings.id, channelRoutingId),
          eq(channelRoutings.enabled, true),
        ),
      );

    if (!channelRouting) throw notFound('Channel routing not found');

    // Look up channel instance
    const [instance] = await db
      .select()
      .from(channelInstances)
      .where(eq(channelInstances.id, channelRouting.channelInstanceId));

    if (!instance) throw notFound('Channel instance not found');

    // Upsert visitor contact
    const contactId = await upsertVisitorContact(db, body.visitorToken);

    // Check for existing active conversation for this visitor + channel routing
    const [existingConversation] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.channelRoutingId, channelRoutingId),
          eq(conversations.contactId, contactId),
          eq(conversations.status, 'active'),
        ),
      );

    if (existingConversation) {
      return c.json({
        conversationId: existingConversation.id,
        agentId: existingConversation.agentId,
      });
    }

    // Create new conversation
    const conversation = await createConversation(
      { db, scheduler, realtime },
      {
        channelRoutingId: channelRouting.id,
        contactId,
        agentId: channelRouting.agentId,
        channelInstanceId: channelRouting.channelInstanceId,
      },
    );

    return c.json({
      conversationId: conversation.id,
      agentId: conversation.agentId,
    });
  })
  /** GET /chat/:channelRoutingId/conversations/:conversationId — Load message history. */
  .get('/chat/:channelRoutingId/conversations/:conversationId', async (c) => {
    const { db } = getCtx(c);
    const channelRoutingId = c.req.param('channelRoutingId');
    const conversationId = c.req.param('conversationId');
    const visitorToken = c.req.query('visitorToken') ?? '';

    if (!visitorToken) throw unauthorized();

    // Verify the conversation belongs to this channel routing and visitor
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.channelRoutingId, channelRoutingId),
        ),
      );

    if (!conversation) throw notFound('Conversation not found');

    // Verify visitor owns this conversation
    const [contact] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.identifier, `visitor:${visitorToken}`));

    if (!contact || contact.id !== conversation.contactId) throw unauthorized();

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
        id: conversation.id,
        title: null,
        agentId: conversation.agentId,
        messages,
      });
    } catch {
      // Memory unavailable — return empty
      return c.json({
        id: conversation.id,
        title: null,
        agentId: conversation.agentId,
        messages: [],
      });
    }
  })
  /** POST /chat/:channelRoutingId/reset — Reset: complete current conversation + start a new one. */
  .post('/chat/:channelRoutingId/reset', async (c) => {
    const { db, scheduler, realtime } = getCtx(c);
    const channelRoutingId = c.req.param('channelRoutingId');
    const body = resetSchema.parse(await c.req.json());

    // Look up channel routing
    const [channelRouting] = await db
      .select()
      .from(channelRoutings)
      .where(
        and(
          eq(channelRoutings.id, channelRoutingId),
          eq(channelRoutings.enabled, true),
        ),
      );

    if (!channelRouting) throw notFound('Channel routing not found');

    // Verify visitor
    const contactId = await upsertVisitorContact(db, body.visitorToken);

    // Complete any active conversation for this visitor + channel routing
    const [activeConversation] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.channelRoutingId, channelRoutingId),
          eq(conversations.contactId, contactId),
          eq(conversations.status, 'active'),
        ),
      );

    if (activeConversation) {
      await completeConversation(
        db,
        activeConversation.id,
        realtime,
        'abandoned',
      );
    }

    // Create fresh conversation
    const conversation = await createConversation(
      { db, scheduler, realtime },
      {
        channelRoutingId: channelRouting.id,
        contactId,
        agentId: channelRouting.agentId,
        channelInstanceId: channelRouting.channelInstanceId,
      },
    );

    return c.json({
      conversationId: conversation.id,
      agentId: conversation.agentId,
    });
  })
  /** POST /chat/:channelRoutingId/stream — Stream agent response for public chat. */
  .post('/chat/:channelRoutingId/stream', async (c) => {
    const { db } = getCtx(c);
    const channelRoutingId = c.req.param('channelRoutingId');
    const visitorToken =
      new URL(c.req.url).searchParams.get('visitorToken') ?? '';

    if (!visitorToken) throw unauthorized();

    // Verify visitor
    const [contact] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.identifier, `visitor:${visitorToken}`));

    if (!contact) throw unauthorized();

    // Find the active conversation for this visitor + channel routing
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.channelRoutingId, channelRoutingId),
          eq(conversations.contactId, contact.id),
          eq(conversations.status, 'active'),
        ),
      );

    if (!conversation) throw notFound('No active conversation');

    // Check handler mode
    if (conversation.handler === 'human' || conversation.handler === 'paused') {
      return c.json(
        {
          error:
            'Conversation is in human/paused mode — AI responses are disabled',
        },
        403,
      );
    }

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
      conversationId: conversation.id,
      message: lastUserMsg,
      agentId: conversation.agentId,
      resourceId: `contact:${contact.id}`,
    });

    // Bridge to AI SDK v6 UIMessageStream format
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
