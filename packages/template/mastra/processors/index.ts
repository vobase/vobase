/**
 * DynamicArgument processor factories for Mastra agents.
 * These return InputProcessor/OutputProcessor arrays based on requestContext,
 * enabling static Agent instances to resolve processors at runtime.
 */
import type { Mastra } from '@mastra/core';
import type { InputProcessorOrWorkflow } from '@mastra/core/processors';
import type { RequestContext } from '@mastra/core/request-context';

import { getModuleDbOrNull } from '../../modules/ai/lib/deps';
import { createModerationProcessor } from './moderation';
import { createModerationLogger } from './moderation-logger';

/** Shape of requestContext passed by chat/channel handlers. */
export interface AgentRequestContext {
  conversationId: string;
  contactId?: string | null;
  channel?: string;
  agentId?: string;
}

/**
 * Dynamic input processors: moderation only.
 * Memory recall is now handled by Mastra Memory's built-in semantic recall + OM.
 * Returns empty array in Studio context (no requestContext).
 */
export function resolveInputProcessors({
  requestContext,
}: {
  requestContext: RequestContext<unknown>;
  mastra?: Mastra;
}): InputProcessorOrWorkflow[] {
  const rc = (
    requestContext?.get?.('conversationId')
      ? Object.fromEntries(
          ['conversationId', 'contactId', 'channel', 'agentId'].map((k) => [
            k,
            requestContext.get(k),
          ]),
        )
      : undefined
  ) as AgentRequestContext | undefined;

  const db = getModuleDbOrNull();
  if (!rc?.conversationId || !db) return [];

  return [
    createModerationProcessor(
      undefined,
      createModerationLogger(db, {
        agentId: rc.agentId ?? 'unknown',
        channel: rc.channel ?? 'web',
        contactId: rc.contactId ?? undefined,
        conversationId: rc.conversationId,
      }),
    ),
  ];
}
