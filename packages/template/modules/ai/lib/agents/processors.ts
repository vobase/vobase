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

import { getModuleDbOrNull, getModuleScheduler } from '../deps';
import { createModerationProcessor } from '../guardrails/moderation';
import { createModerationLogger } from '../guardrails/moderation-logger';
import {
  createMemoryInputProcessor,
  createMemoryOutputProcessor,
} from '../memory/memory-processor';
import { resolveScope } from './shared';

/** Shape of requestContext passed by chat/channel handlers. */
export interface AgentRequestContext {
  threadId: string;
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
    requestContext?.get?.('threadId')
      ? Object.fromEntries(
          ['threadId', 'contactId', 'userId', 'channel', 'agentId'].map((k) => [
            k,
            requestContext.get(k),
          ]),
        )
      : undefined
  ) as AgentRequestContext | undefined;

  const db = getModuleDbOrNull();
  if (!rc?.threadId || !db) return [];

  const scope = resolveScope({
    threadId: rc.threadId,
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
        threadId: rc.threadId,
      }),
    ),
  ];

  if (scope) {
    processors.push(
      createMemoryInputProcessor({
        db,
        threadId: rc.threadId,
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
    requestContext?.get?.('threadId')
      ? Object.fromEntries(
          ['threadId', 'contactId', 'userId', 'channel', 'agentId'].map((k) => [
            k,
            requestContext.get(k),
          ]),
        )
      : undefined
  ) as AgentRequestContext | undefined;

  const db = getModuleDbOrNull();
  if (!rc?.threadId || !db) return [];

  let scheduler: ReturnType<typeof getModuleScheduler>;
  try {
    scheduler = getModuleScheduler();
  } catch {
    return [];
  }

  const scope = resolveScope({
    threadId: rc.threadId,
    contactId: rc.contactId,
    userId: rc.userId,
  });

  if (!scope) return [];

  return [
    createMemoryOutputProcessor({
      db,
      scheduler,
      threadId: rc.threadId,
      scope,
    }),
  ];
}
