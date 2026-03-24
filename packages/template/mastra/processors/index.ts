/**
 * DynamicArgument processor factories for Mastra agents.
 * These return InputProcessor/OutputProcessor arrays based on requestContext,
 * enabling static Agent instances to resolve processors at runtime.
 */
import type { Mastra } from '@mastra/core';
import type {
  InputProcessorOrWorkflow,
  OutputProcessorOrWorkflow,
} from '@mastra/core/processors';
import type { RequestContext } from '@mastra/core/request-context';

import { resolveScope } from '../lib/agents/shared';
import { getModuleDbOrNull, getModuleScheduler } from '../lib/deps';
import {
  createMemoryInputProcessor,
  createMemoryOutputProcessor,
} from './memory/memory-processor';
import { createModerationProcessor } from './moderation';
import { createModerationLogger } from './moderation-logger';

/** Shape of requestContext passed by chat/channel handlers. */
export interface AgentRequestContext {
  conversationId: string;
  contactId?: string | null;
  userId?: string | null;
  channel?: string;
  agentId?: string;
}

/**
 * Dynamic input processors: moderation + memory retrieval.
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
          ['conversationId', 'contactId', 'userId', 'channel', 'agentId'].map(
            (k) => [k, requestContext.get(k)],
          ),
        )
      : undefined
  ) as AgentRequestContext | undefined;

  const db = getModuleDbOrNull();
  if (!rc?.conversationId || !db) return [];

  const scope = resolveScope({
    conversationId: rc.conversationId,
    contactId: rc.contactId,
    userId: rc.userId,
  });

  const processors: InputProcessorOrWorkflow[] = [
    createModerationProcessor(
      undefined,
      createModerationLogger(db, {
        agentId: rc.agentId ?? 'unknown',
        channel: rc.channel ?? 'web',
        userId: rc.userId ?? undefined,
        contactId: rc.contactId ?? undefined,
        conversationId: rc.conversationId,
      }),
    ),
  ];

  if (scope) {
    processors.push(
      createMemoryInputProcessor({
        db,
        conversationId: rc.conversationId,
        scope,
      }),
    );
  }

  return processors;
}

/**
 * Dynamic output processors: memory formation.
 * Returns empty array in Studio context (no requestContext).
 */
export function resolveOutputProcessors({
  requestContext,
}: {
  requestContext: RequestContext<unknown>;
  mastra?: Mastra;
}): OutputProcessorOrWorkflow[] {
  const rc = (
    requestContext?.get?.('conversationId')
      ? Object.fromEntries(
          ['conversationId', 'contactId', 'userId', 'channel', 'agentId'].map(
            (k) => [k, requestContext.get(k)],
          ),
        )
      : undefined
  ) as AgentRequestContext | undefined;

  const db = getModuleDbOrNull();
  if (!rc?.conversationId || !db) return [];

  let scheduler: ReturnType<typeof getModuleScheduler>;
  try {
    scheduler = getModuleScheduler();
  } catch {
    return [];
  }

  const scope = resolveScope({
    conversationId: rc.conversationId,
    contactId: rc.contactId,
    userId: rc.userId,
  });

  if (!scope) return [];

  return [
    createMemoryOutputProcessor({
      db,
      scheduler,
      conversationId: rc.conversationId,
      scope,
    }),
  ];
}
