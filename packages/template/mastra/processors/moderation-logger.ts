import type { RealtimeService, VobaseDb } from '@vobase/core';
import { logger } from '@vobase/core';

import { aiModerationLogs } from '../../modules/ai/schema';
import { emitActivityEvent } from '../../modules/conversations/lib/activity-events';
import type { OnBlockCallback } from './moderation';

interface ModerationLogContext {
  agentId: string;
  channel: string;
  userId?: string | null;
  contactId?: string | null;
  conversationId?: string | null;
}

export function createModerationLogger(
  db: VobaseDb,
  context: ModerationLogContext,
  realtime?: RealtimeService,
): OnBlockCallback {
  return (info) => {
    db.insert(aiModerationLogs)
      .values({
        agentId: context.agentId,
        channel: context.channel,
        userId: context.userId ?? null,
        contactId: context.contactId ?? null,
        threadId: context.conversationId ?? null,
        reason: info.reason,
        blockedContent: info.content.slice(0, 200),
        matchedTerm: info.matchedTerm ?? null,
      })
      .catch((err) => {
        logger.warn('[guardrails] Failed to log moderation event', {
          error: err,
        });
      });

    if (realtime) {
      emitActivityEvent(db, realtime, {
        type: 'guardrail.block',
        agentId: context.agentId,
        source: 'system',
        contactId: context.contactId ?? undefined,
        conversationId: context.conversationId ?? undefined,
        channelType: context.channel,
        data: {
          reason: info.reason,
          matchedTerm: info.matchedTerm,
        },
        resolutionStatus: 'pending',
      }).catch((err) => {
        logger.error('[guardrails] Failed to emit guardrail.block event', {
          error: err,
        });
      });
    }
  };
}
