/**
 * Session lifecycle — create, resume, complete, and fail conversation sessions.
 *
 * Session ID = Mastra Memory threadId = chat-sdk thread ID (AD-2).
 */
import type { VobaseDb } from '@vobase/core';
import { createNanoid, logger } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { getMemory } from '../../../mastra';
import { sessions } from '../schema';
import { getChatState } from './chat-init';

const generateId = createNanoid();

interface CreateSessionInput {
  endpointId: string;
  contactId: string;
  agentId: string;
  channel: string;
}

/** Create a new session, subscribe in chat state, and create a Mastra Memory thread. */
export async function createSession(
  db: VobaseDb,
  input: CreateSessionInput,
): Promise<typeof sessions.$inferSelect> {
  const id = generateId();

  const [session] = await db
    .insert(sessions)
    .values({
      id,
      endpointId: input.endpointId,
      contactId: input.contactId,
      agentId: input.agentId,
      channel: input.channel,
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
        resourceId: `contact:${input.contactId}`,
        createdAt: now,
        updatedAt: now,
        metadata: {
          agentId: input.agentId,
          channel: input.channel,
          endpointId: input.endpointId,
        },
      },
    });
  } catch (err) {
    logger.warn('[conversations] Failed to create memory thread', {
      sessionId: id,
      error: err,
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
  await db
    .update(sessions)
    .set({
      status: 'completed',
      endedAt: new Date(),
    })
    .where(eq(sessions.id, sessionId));

  const state = getChatState();
  await state.unsubscribe(sessionId);
}

/** Fail a session — set status, end time, store reason in metadata. */
export async function failSession(
  db: VobaseDb,
  sessionId: string,
  reason: string,
): Promise<void> {
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
}
