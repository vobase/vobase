/**
 * DynamicArgument processor factories for Mastra agents.
 * These return InputProcessor/OutputProcessor arrays based on requestContext,
 * enabling static Agent instances to resolve processors at runtime.
 */
import type { Mastra } from '@mastra/core';
import type { InputProcessorOrWorkflow } from '@mastra/core/processors';
import type { RequestContext } from '@mastra/core/request-context';

import type { ModuleDeps } from '../../../messaging/lib/deps';
import { createConversationSyncProcessor } from './conversation-sync';
import { createModerationProcessor } from './moderation';
import { createModerationLogger } from './moderation-logger';

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
  const conversationId = requestContext?.get?.('conversationId') as
    | string
    | undefined;
  if (!conversationId) return [];

  const deps = requestContext.get('deps') as ModuleDeps | undefined;
  if (!deps) return [];

  const agentId =
    (requestContext.get('agentId') as string | undefined) ?? 'unknown';
  const channel =
    (requestContext.get('channel') as string | undefined) ?? 'web';
  const contactId = requestContext.get('contactId') as string | undefined;

  return [
    createConversationSyncProcessor(),
    createModerationProcessor(
      undefined,
      createModerationLogger(deps.db, {
        agentId,
        channel,
        contactId,
        conversationId,
      }),
    ),
  ];
}
