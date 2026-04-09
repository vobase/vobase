/**
 * Chat streaming — web chat SSE response generation.
 *
 * Acquires a Postgres advisory lock, streams agent response, releases lock.
 * Used by the POST /chat handler for web-based interactions.
 */
import { RequestContext } from '@mastra/core/request-context';
import type { VobaseDb } from '@vobase/core';
import { logger } from '@vobase/core';
import { sql } from 'drizzle-orm';

import { getAgent } from '../../../mastra/agents';
import { getModuleDeps } from './deps';

interface StreamChatInput {
  db: VobaseDb;
  interactionId: string;
  /** Last user message text — passed as a string to the agent. */
  message: string;
  agentId: string;
  resourceId: string;
  /** Contact or user ID for RequestContext. */
  contactId?: string | null;
  /** Channel type — defaults to 'web'. */
  channelType?: string;
  /** Number of times this interaction has been reopened. */
  reopenCount?: number;
}

/** Fixed class ID for Vobase advisory locks — prevents collisions with other pg_advisory_lock users. */
const VOBASE_LOCK_CLASS = 0x766f6261; // "voba"

/** Hash a string to a stable int32 for use as a Postgres advisory lock key. */
function hashStringToInt(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (Math.imul(31, hash) + s.charCodeAt(i)) | 0;
  }
  return hash;
}

/** Stream an agent response for web chat. Returns the Mastra stream result. */
export async function streamChat(input: StreamChatInput) {
  const {
    db,
    interactionId,
    message,
    agentId,
    resourceId,
    contactId,
    channelType,
    reopenCount,
  } = input;

  const registered = getAgent(agentId);
  if (!registered) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  // Acquire Postgres advisory lock to prevent concurrent generation
  // Two-arg form: (classId, objId) namespaces the lock to avoid collisions
  const lockKey = hashStringToInt(interactionId);
  const result = await db.execute(
    sql`SELECT pg_try_advisory_lock(${VOBASE_LOCK_CLASS}, ${lockKey}) as locked`,
  );
  const rows = Array.isArray(result)
    ? result
    : ((result as unknown as { rows: unknown[] }).rows ?? []);
  const locked = (rows[0] as Record<string, unknown>)?.locked;

  if (!locked) {
    throw new Error(
      `Interaction ${interactionId} is locked — concurrent generation in progress`,
    );
  }

  // Build RequestContext so sendCard tool and processors can access channel type
  const rc = new RequestContext();
  rc.set('interactionId', interactionId);
  rc.set('contactId', contactId ?? null);
  rc.set('channel', channelType ?? 'web');
  rc.set('agentId', agentId);
  rc.set('deps', getModuleDeps());

  // Inject reopenCount context if applicable
  let contextPrefix = '';
  if (reopenCount && reopenCount > 0) {
    contextPrefix = `[System]: This interaction was reopened ${reopenCount} time(s). The contact is returning to a previously resolved topic.\n\n`;
  }

  try {
    // Pass as a string — agent + memory handles full interaction context
    const result = await registered.agent.stream(contextPrefix + message, {
      memory: {
        thread: interactionId,
        resource: resourceId,
      },
      maxSteps: 5,
      requestContext: rc,
    });

    return result;
  } catch (err) {
    logger.error('[interactions] Stream generation failed', {
      interactionId,
      agentId,
      error: err,
    });
    throw err;
  } finally {
    await db.execute(
      sql`SELECT pg_advisory_unlock(${VOBASE_LOCK_CLASS}, ${lockKey})`,
    );
  }
}
