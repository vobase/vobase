import type { VobaseDb } from '@vobase/core';
import { logger } from '@vobase/core';

import { aiModerationLogs } from '../../modules/ai/schema';
import type { OnBlockCallback } from './moderation';

interface ModerationLogContext {
  agentId: string;
  channel: string;
  userId?: string | null;
  contactId?: string | null;
  threadId?: string | null;
}

/**
 * Create a fire-and-forget onBlock callback that logs moderation events to the DB.
 * Centralizes insert logic so both chat-agent and channel-reply-agent use the same code.
 */
export function createModerationLogger(
  db: VobaseDb,
  context: ModerationLogContext,
): OnBlockCallback {
  return (info) => {
    db.insert(aiModerationLogs)
      .values({
        agentId: context.agentId,
        channel: context.channel,
        userId: context.userId ?? null,
        contactId: context.contactId ?? null,
        threadId: context.threadId ?? null,
        reason: info.reason,
        blockedContent: info.content.slice(0, 200),
        matchedTerm: info.matchedTerm ?? null,
      })
      .catch((err) => {
        logger.warn('[guardrails] Failed to log moderation event', {
          error: err,
        });
      });
  };
}
