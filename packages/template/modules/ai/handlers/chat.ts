import { TZDate } from '@date-fns/tz';
import { toAISdkStream } from '@mastra/ai-sdk';
import type { VobaseDb } from '@vobase/core';
import { getCtx, nextSequence, notFound, unauthorized } from '@vobase/core';
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { format, getDay } from 'date-fns';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getMemory } from '../../../mastra';
import { getAgent } from '../../../mastra/agents';
import { streamChat } from '../lib/chat-stream';
import { createInteraction, resolveInteraction } from '../lib/interaction';
import {
  channelInstances,
  channelRoutings,
  contacts,
  interactions,
} from '../schema';

const chatSchema = z.object({
  interactionId: z.string().optional(),
  agentId: z.string().min(1),
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant', 'system']),
      content: z.string(),
    }),
  ),
});

/** Mon=A, Tue=B, … Sun=G. Daily-resetting visitor names like "Visitor A001". */
const DAY_LETTERS = ['G', 'A', 'B', 'C', 'D', 'E', 'F'] as const;
const DEFAULT_TZ = process.env.TZ || 'Asia/Singapore';

/** Build a timezone-consistent date key + day letter. */
export function visitorDayInfo(now = new Date(), tz = DEFAULT_TZ) {
  const local = new TZDate(now, tz);
  const dateKey = format(local, 'yyyyMMdd');
  const letter = DAY_LETTERS[getDay(local)];
  return { dateKey, letter };
}

async function generateVisitorName(db: VobaseDb): Promise<string> {
  const { dateKey, letter } = visitorDayInfo();
  const seq = await nextSequence(db, `VIS-${letter}-${dateKey}`, {
    padLength: 3,
  });
  // seq = "VIS-A-20260331-001" → extract trailing number
  const num = seq.split('-').pop() ?? '';
  return `Visitor ${letter}${num}`;
}

/**
 * Atomic contact upsert keyed by `user:{userId}` identifier.
 * Uses ON CONFLICT so concurrent requests for the same user are safe.
 * Email is intentionally omitted from the insert to avoid unique-constraint
 * collisions when a channel contact already owns that email address.
 */
async function upsertContact(
  db: VobaseDb,
  opts: {
    userId: string;
    role?: 'customer' | 'staff';
    name?: string | null;
  },
): Promise<string> {
  const identifier = `user:${opts.userId}`;

  // Fast path: existing contact — just touch updatedAt, no sequence wasted
  const existing = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.identifier, identifier))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(contacts)
      .set({ updatedAt: new Date() })
      .where(eq(contacts.identifier, identifier));
    return existing[0].id;
  }

  // Slow path: new contact — generate visitor name then insert with
  // onConflictDoUpdate as a safety net against concurrent first-chat races
  const name =
    opts.name ?? (opts.role === 'staff' ? null : await generateVisitorName(db));

  const [row] = await db
    .insert(contacts)
    .values({ identifier, name, role: opts.role ?? 'customer' })
    .onConflictDoUpdate({
      target: contacts.identifier,
      set: { updatedAt: new Date() },
    })
    .returning({ id: contacts.id });

  return row.id;
}

export const chatHandlers = new Hono()
  /** POST /chat — Web chat: stream agent response. Creates interaction if needed. */
  .post('/chat', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const body = chatSchema.parse(await c.req.json());

    // Validate agent exists
    const registered = getAgent(body.agentId);
    if (!registered) throw notFound('Agent not found');

    // Resolve or create interaction
    let interactionId = body.interactionId;
    let contactId: string;

    if (!interactionId) {
      // New interaction — create contact for authenticated user
      contactId = await upsertContact(db, {
        userId: user.id,
        role: 'staff',
        name: user.name,
      });

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
      const interaction = await createInteraction(
        { db, scheduler, realtime },
        {
          channelRoutingId: channelRouting.id,
          contactId,
          agentId: body.agentId,
          channelInstanceId: webInstance.id,
        },
      );
      interactionId = interaction.id;
    } else {
      // Existing interaction — read contactId + mode in one query
      const [existing] = await db
        .select({
          contactId: interactions.contactId,
          mode: interactions.mode,
        })
        .from(interactions)
        .where(eq(interactions.id, interactionId));

      if (!existing) throw notFound('Interaction not found');

      if (existing.mode === 'human' || existing.mode === 'held') {
        return c.json(
          {
            error:
              'Interaction is in human/held mode — AI responses are disabled',
          },
          403,
        );
      }

      if (!existing.contactId) throw notFound('Interaction has no contact');
      contactId = existing.contactId;
    }

    // Extract last user message for streaming
    const lastUserMessage =
      body.messages.findLast((m) => m.role === 'user')?.content ?? '';

    // Stream response
    const result = await streamChat({
      db,
      interactionId: interactionId,
      message: lastUserMessage,
      agentId: body.agentId,
      resourceId: `contact:${contactId}`,
      contactId,
    });

    // Bridge Mastra stream to AI SDK SSE format
    const stream = toAISdkStream(result, {
      from: 'agent',
      version: 'v6',
      sendReasoning: true,
      sendSources: true,
    });

    return new Response(stream as unknown as BodyInit, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Interaction-Id': interactionId,
      },
    });
  })
  /** POST /chat/:channelRoutingId/start — Start or resume a public chat interaction. */
  .post('/chat/:channelRoutingId/start', async (c) => {
    const { db, user, scheduler, realtime } = getCtx(c);
    if (!user) throw unauthorized();
    const channelRoutingId = c.req.param('channelRoutingId');

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

    // Upsert visitor contact from session user
    const contactId = await upsertContact(db, { userId: user.id });

    // Check for existing active interaction for this visitor + channel routing
    const [existingInteraction] = await db
      .select()
      .from(interactions)
      .where(
        and(
          eq(interactions.channelRoutingId, channelRoutingId),
          eq(interactions.contactId, contactId),
          eq(interactions.status, 'active'),
        ),
      );

    if (existingInteraction) {
      return c.json({
        interactionId: existingInteraction.id,
        agentId: existingInteraction.agentId,
      });
    }

    // Create new interaction
    const interaction = await createInteraction(
      { db, scheduler, realtime },
      {
        channelRoutingId: channelRouting.id,
        contactId,
        agentId: channelRouting.agentId,
        channelInstanceId: channelRouting.channelInstanceId,
      },
    );

    return c.json({
      interactionId: interaction.id,
      agentId: interaction.agentId,
    });
  })
  /** GET /chat/:channelRoutingId/interactions/:interactionId — Load message history. */
  .get('/chat/:channelRoutingId/interactions/:interactionId', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();
    const channelRoutingId = c.req.param('channelRoutingId');
    const interactionId = c.req.param('interactionId');

    // Verify the interaction belongs to this channel routing
    const [interaction] = await db
      .select()
      .from(interactions)
      .where(
        and(
          eq(interactions.id, interactionId),
          eq(interactions.channelRoutingId, channelRoutingId),
        ),
      );

    if (!interaction) throw notFound('Interaction not found');

    // Verify visitor owns this interaction
    const [contact] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.identifier, `user:${user.id}`));

    if (!contact || contact.id !== interaction.contactId) throw unauthorized();

    // Load messages from Mastra Memory
    try {
      const memory = getMemory();
      const result = await memory.recall({ threadId: interactionId });
      const messages = (result?.messages ?? [])
        .filter((m) => {
          // Filter out internal notes from public chat history
          const raw = m.content as unknown;
          if (typeof raw === 'object' && raw !== null && 'metadata' in raw) {
            const meta = (raw as { metadata?: { visibility?: string } })
              .metadata;
            if (meta?.visibility === 'internal') return false;
          }
          return true;
        })
        .map((m) => {
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

          // Normalize tool parts from Mastra/v5 format to AI SDK v6 format
          const normalizedParts = parts.map((p) => {
            // Mastra native: { type: 'tool-call', toolName, args, result }
            if (p.type === 'tool-call' && p.toolName) {
              const hasResult = p.result !== undefined;
              return {
                type: `tool-${p.toolName as string}`,
                toolCallId: p.toolCallId as string | undefined,
                state: hasResult ? 'output-available' : 'input-available',
                input: p.args,
                ...(hasResult ? { output: p.result } : {}),
              };
            }
            // AI SDK v5: { type: 'tool-invocation', toolInvocation: { toolName, state, args, result } }
            if (p.type === 'tool-invocation' && p.toolInvocation) {
              const inv = p.toolInvocation as {
                toolName: string;
                toolCallId?: string;
                state: string;
                args?: unknown;
                result?: unknown;
              };
              const hasResult =
                inv.state === 'result' || inv.result !== undefined;
              return {
                type: `tool-${inv.toolName}`,
                toolCallId: inv.toolCallId,
                state: hasResult ? 'output-available' : 'input-available',
                input: inv.args,
                ...(hasResult ? { output: inv.result } : {}),
              };
            }
            return p;
          });

          return {
            id: m.id,
            role: m.role,
            parts: normalizedParts,
            createdAt: m.createdAt ?? new Date().toISOString(),
          };
        });

      return c.json({
        id: interaction.id,
        title: null,
        agentId: interaction.agentId,
        messages,
      });
    } catch {
      // Memory unavailable — return empty
      return c.json({
        id: interaction.id,
        title: null,
        agentId: interaction.agentId,
        messages: [],
      });
    }
  })
  /** POST /chat/:channelRoutingId/reset — Reset: resolve current interaction + start a new one. */
  .post('/chat/:channelRoutingId/reset', async (c) => {
    const { db, user, scheduler, realtime } = getCtx(c);
    if (!user) throw unauthorized();
    const channelRoutingId = c.req.param('channelRoutingId');

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

    // Resolve visitor contact from session
    const contactId = await upsertContact(db, { userId: user.id });

    // Resolve any active interaction for this visitor + channel routing
    const [activeInteraction] = await db
      .select({ id: interactions.id })
      .from(interactions)
      .where(
        and(
          eq(interactions.channelRoutingId, channelRoutingId),
          eq(interactions.contactId, contactId),
          eq(interactions.status, 'active'),
        ),
      );

    if (activeInteraction) {
      await resolveInteraction(db, activeInteraction.id, realtime, 'abandoned');
    }

    // Create fresh interaction
    const interaction = await createInteraction(
      { db, scheduler, realtime },
      {
        channelRoutingId: channelRouting.id,
        contactId,
        agentId: channelRouting.agentId,
        channelInstanceId: channelRouting.channelInstanceId,
      },
    );

    return c.json({
      interactionId: interaction.id,
      agentId: interaction.agentId,
    });
  })
  /** POST /chat/:channelRoutingId/stream — Stream agent response for public chat. */
  .post('/chat/:channelRoutingId/stream', async (c) => {
    const { db, user, realtime } = getCtx(c);
    if (!user) throw unauthorized();
    const channelRoutingId = c.req.param('channelRoutingId');

    // Resolve visitor contact from session
    const [contact] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.identifier, `user:${user.id}`));

    if (!contact) throw unauthorized();

    // Find the active interaction for this visitor + channel routing
    const [interaction] = await db
      .select()
      .from(interactions)
      .where(
        and(
          eq(interactions.channelRoutingId, channelRoutingId),
          eq(interactions.contactId, contact.id),
          eq(interactions.status, 'active'),
        ),
      );

    if (!interaction) throw notFound('No active interaction');

    // Check handler mode
    if (interaction.mode === 'human' || interaction.mode === 'held') {
      return c.json(
        {
          error:
            'Interaction is in human/held mode — AI responses are disabled',
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
      db,
      interactionId: interaction.id,
      message: lastUserMsg,
      agentId: interaction.agentId,
      resourceId: `contact:${contact.id}`,
      contactId: contact.id,
    });

    // Bridge to AI SDK v6 UIMessageStream format
    const interactionIdForNotify = interaction.id;
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        for await (const part of toAISdkStream(result, {
          from: 'agent',
          version: 'v6',
          sendReasoning: true,
          sendSources: true,
        })) {
          writer.write(part);
        }
        // Notify staff view that messages have been updated
        realtime.notify({
          table: 'interactions-messages',
          id: interactionIdForNotify,
        });
      },
    });

    return createUIMessageStreamResponse({ stream });
  });
