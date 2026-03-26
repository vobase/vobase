import { getCtx, notFound, unauthorized } from '@vobase/core';
import { and, asc, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getMemory } from '../../../mastra';
import { enqueueMessage } from '../lib/outbox';
import { channelInstances, consultations, outbox, sessions } from '../schema';

const updateSessionSchema = z.object({
  status: z.enum(['paused', 'completed', 'failed']),
});

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const replySchema = z.object({
  content: z.string().min(1),
});

export const sessionsHandlers = new Hono()
  /** GET /sessions — List sessions with filters and pagination. */
  .get('/sessions', async (c) => {
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
    if (agentId) conditions.push(eq(sessions.agentId, agentId));
    if (contactId) conditions.push(eq(sessions.contactId, contactId));
    if (status) conditions.push(eq(sessions.status, status));
    if (channelInstanceId)
      conditions.push(eq(sessions.channelInstanceId, channelInstanceId));

    const rows = await db
      .select()
      .from(sessions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(sessions.createdAt))
      .limit(limit)
      .offset(offset);

    return c.json(rows);
  })
  /** GET /sessions/:id — Session detail. */
  .get('/sessions/:id', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, c.req.param('id')));

    if (!session) throw notFound('Session not found');

    return c.json(session);
  })
  /** GET /sessions/:id/messages — Load messages from Mastra Memory, fall back to outbox. */
  .get('/sessions/:id/messages', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const sessionId = c.req.param('id');

    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId));

    if (!session) throw notFound('Session not found');

    // Try Mastra Memory first (has full user+assistant transcript)
    try {
      const memory = getMemory();
      const result = await memory.recall({ threadId: sessionId });
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
          .where(eq(outbox.sessionId, sessionId))
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
      .where(eq(outbox.sessionId, sessionId))
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
  /** PATCH /sessions/:id — Update session status. */
  .patch('/sessions/:id', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const body = updateSessionSchema.parse(await c.req.json());
    const sessionId = c.req.param('id');

    const [existing] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId));

    if (!existing) throw notFound('Session not found');

    if (body.status === 'completed' || body.status === 'failed') {
      const { completeSession, failSession } = await import('../lib/session');
      if (body.status === 'completed') {
        await completeSession(db, sessionId);
      } else {
        await failSession(db, sessionId, 'Manually failed by user');
      }
    } else {
      await db
        .update(sessions)
        .set({ status: body.status })
        .where(eq(sessions.id, sessionId));
    }

    const [updated] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId));

    return c.json(updated);
  })
  /** POST /sessions/:id/reply — Human agent reply: save to memory + deliver via channel. */
  .post('/sessions/:id/reply', async (c) => {
    const { db, user, scheduler } = getCtx(c);
    if (!user) throw unauthorized();

    const body = replySchema.parse(await c.req.json());
    const sessionId = c.req.param('id');

    const [session] = await db
      .select({
        id: sessions.id,
        status: sessions.status,
        contactId: sessions.contactId,
        channelInstanceId: sessions.channelInstanceId,
      })
      .from(sessions)
      .where(eq(sessions.id, sessionId));

    if (!session) throw notFound('Session not found');

    if (session.status !== 'active' && session.status !== 'paused') {
      throw notFound('Session is not active or paused');
    }

    let channelType = 'web';
    if (session.channelInstanceId) {
      const [instance] = await db
        .select({ id: channelInstances.id, type: channelInstances.type })
        .from(channelInstances)
        .where(eq(channelInstances.id, session.channelInstanceId));
      if (instance) channelType = instance.type;
    }

    // Save to Mastra Memory so it appears in the conversation transcript
    const staffLabel = user.name ?? user.email;
    const replyText = body.content;
    try {
      const memory = getMemory();
      await memory.saveMessages({
        messages: [
          {
            id: `staff-${Date.now()}`,
            threadId: sessionId,
            resourceId: `contact:${session.contactId}`,
            role: 'assistant' as const,
            createdAt: new Date(),
            content: {
              format: 2,
              parts: [
                { type: 'text', text: `[Staff: ${staffLabel}] ${replyText}` },
              ],
              content: `[Staff: ${staffLabel}] ${replyText}`,
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
        sessionId,
        content: replyText,
        channelType,
        channelInstanceId: session.channelInstanceId ?? undefined,
      });
    }

    return c.json({ success: true, channelType }, 201);
  })
  /** GET /sessions/:id/consultations — List consultations for a session. */
  .get('/sessions/:id/consultations', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const sessionId = c.req.param('id');

    const [session] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.id, sessionId));

    if (!session) throw notFound('Session not found');

    const rows = await db
      .select({
        id: consultations.id,
        sessionId: consultations.sessionId,
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
      .where(eq(consultations.sessionId, sessionId))
      .orderBy(desc(consultations.createdAt));

    return c.json(rows);
  });
