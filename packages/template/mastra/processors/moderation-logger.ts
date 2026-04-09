import type { RealtimeService, VobaseDb } from '@vobase/core';
import { logger } from '@vobase/core';

import { createActivityMessage } from '../../modules/ai/lib/messages';
import { aiModerationLogs } from '../../modules/ai/schema';
import type { OnBlockCallback } from './moderation';

interface ModerationLogContext {
  agentId: string;
  channel: string;
  userId?: string | null;
  contactId?: string | null;
  interactionId?: string | null;
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
        threadId: context.interactionId ?? null,
        reason: info.reason,
        blockedContent: info.content.slice(0, 200),
        matchedTerm: info.matchedTerm ?? null,
      })
      .catch((err) => {
        logger.warn('[guardrails] Failed to log moderation event', {
          error: err,
        });
      });

    if (realtime && context.interactionId) {
      createActivityMessage(db, realtime, {
        interactionId: context.interactionId,
        eventType: 'guardrail.block',
        actor: context.agentId,
        actorType: 'system',
        data: {
          reason: info.reason,
          matchedTerm: info.matchedTerm,
          contactId: context.contactId,
          channelType: context.channel,
        },
        resolutionStatus: 'pending',
      }).catch((err: unknown) => {
        logger.error('[guardrails] Failed to emit guardrail.block event', {
          error: err,
        });
      });
    }
  };
}
