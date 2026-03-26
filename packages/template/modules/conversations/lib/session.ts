/**
 * Session lifecycle — create, resume, complete, and fail conversation sessions.
 *
 * Session ID = Mastra Memory threadId = chat-sdk thread ID (AD-2).
 */
import type { Scheduler, VobaseDb } from '@vobase/core';
import { createNanoid, logger, notFound } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { getMemory } from '../../../mastra';
import { endpoints, sessions } from '../schema';
import { getChatState } from './chat-init';

const generateId = createNanoid();

interface CreateSessionInput {
  endpointId: string;
  contactId: string;
  agentId: string;
  channelInstanceId: string;
}

interface CreateSessionDeps {
  db: VobaseDb;
  scheduler: Scheduler;
}

/**
 * Create a new session, subscribe in chat state, and create a Mastra Memory thread.
 * If memory thread creation fails, the session is created in degraded mode
 * (memoryDegraded: true) and a retry job is scheduled. A memoryless response
 * is better than no response.
 */
export async function createSession(
  deps: CreateSessionDeps,
  input: CreateSessionInput,
): Promise<typeof sessions.$inferSelect> {
  const { db, scheduler } = deps;
  const id = generateId();
  const start = Date.now();

  // M9: Verify the endpoint exists before creating the session
  const [endpoint] = await db
    .select()
    .from(endpoints)
    .where(eq(endpoints.id, input.endpointId));

  if (!endpoint) throw notFound('Endpoint not found');

  const [session] = await db
    .insert(sessions)
    .values({
      id,
      endpointId: input.endpointId,
      contactId: input.contactId,
      agentId: input.agentId,
      channelInstanceId: input.channelInstanceId,
      status: 'active',
    })
    .returning();

  // Subscribe in chat state for distributed tracking
  const state = getChatState();
  await state.subscribe(id);

  // Create Mastra Memory thread with the same ID (AD-2)
  try {
    const memory = getMemory();
    const now = new Date();
    await memory.saveThread({
      thread: {
        id,
        title: 'New conversation',
        resourceId: `contact:${input.contactId}`,
        createdAt: now,
        updatedAt: now,
        metadata: {
          agentId: input.agentId,
          channelInstanceId: input.channelInstanceId,
          endpointId: input.endpointId,
        },
      },
    });

    logger.info('[conversations] session_create', {
      sessionId: id,
      endpointId: input.endpointId,
      agentId: input.agentId,
      durationMs: Date.now() - start,
      outcome: 'created',
    });
  } catch (err) {
    logger.error(
      '[conversations] Failed to create memory thread — session degraded',
      {
        sessionId: id,
        error: err,
      },
    );

    // Mark session as memory-degraded so agent knows context is limited
    await db
      .update(sessions)
      .set({
        metadata: { memoryDegraded: true },
      })
      .where(eq(sessions.id, id));

    logger.info('[conversations] session_create', {
      sessionId: id,
      endpointId: input.endpointId,
      agentId: input.agentId,
      durationMs: Date.now() - start,
      outcome: 'degraded',
    });

    // Schedule retry job to attempt memory thread creation later
    await scheduler
      .add('conversations:retry-memory-thread', {
        sessionId: id,
        contactId: input.contactId,
        agentId: input.agentId,
        channelInstanceId: input.channelInstanceId,
        endpointId: input.endpointId,
        attempt: 1,
      })
      .catch(() => {
        // Best-effort retry scheduling
      });
  }

  return session;
}

/** Resume an existing active session. Returns the session or null if not active. */
export async function resumeSession(
  db: VobaseDb,
  sessionId: string,
): Promise<typeof sessions.$inferSelect | null> {
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId));

  if (!session || session.status !== 'active') return null;

  return session;
}

/** Complete a session — set status, end time, unsubscribe from chat state. */
export async function completeSession(
  db: VobaseDb,
  sessionId: string,
): Promise<void> {
  const start = Date.now();

  await db
    .update(sessions)
    .set({
      status: 'completed',
      endedAt: new Date(),
    })
    .where(eq(sessions.id, sessionId));

  const state = getChatState();
  await state.unsubscribe(sessionId);

  logger.info('[conversations] session_complete', {
    sessionId,
    durationMs: Date.now() - start,
    outcome: 'completed',
  });
}

/** Fail a session — set status, end time, store reason in metadata. */
export async function failSession(
  db: VobaseDb,
  sessionId: string,
  reason: string,
): Promise<void> {
  const start = Date.now();

  const [existing] = await db
    .select({ metadata: sessions.metadata })
    .from(sessions)
    .where(eq(sessions.id, sessionId));

  const metadata =
    existing?.metadata && typeof existing.metadata === 'object'
      ? {
          ...(existing.metadata as Record<string, unknown>),
          failReason: reason,
        }
      : { failReason: reason };

  await db
    .update(sessions)
    .set({
      status: 'failed',
      endedAt: new Date(),
      metadata,
    })
    .where(eq(sessions.id, sessionId));

  const state = getChatState();
  await state.unsubscribe(sessionId);

  logger.info('[conversations] session_fail', {
    sessionId,
    reason,
    durationMs: Date.now() - start,
    outcome: 'failed',
  });
}
