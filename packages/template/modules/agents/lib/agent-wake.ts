import { RequestContext } from '@mastra/core/request-context';
import type { Scheduler } from '@vobase/core';
import { defineJob, logger } from '@vobase/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { getModuleDeps } from '../../messaging/lib/deps';
import { channelInstances, conversations } from '../../messaging/schema';
import { dynamicToolStep } from '../mastra/processors/dynamic-tools';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Agent wake — schedule & handle agent-wake jobs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface WakeAgentParams {
  agentId: string;
  contactId: string;
  conversationId: string;
  trigger: 'inbound_message' | 'scheduled_followup' | 'supervisor' | 'manual';
  payload?: Record<string, unknown>;
}

const wakeAgentSchema = z.object({
  agentId: z.string().min(1),
  contactId: z.string().min(1),
  conversationId: z.string().min(1),
  trigger: z.enum([
    'inbound_message',
    'scheduled_followup',
    'supervisor',
    'manual',
  ]),
  payload: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Schedule an agent-wake job with a 2-second debounce.
 * Rapid consecutive calls (e.g. 5 messages in 1 second) collapse into a single wake.
 */
async function wakeAgent(
  scheduler: Scheduler,
  params: WakeAgentParams,
): Promise<void> {
  await scheduler.add('agents:agent-wake', params, {
    singletonKey: `agents:agent-wake:${params.agentId}:${params.contactId}`,
    startAfter: 2,
  });
}

/** Iteration guard: inject wrap-up feedback at step 15+. */
export function iterationGuard({ iteration }: { iteration: number }) {
  if (iteration >= 15) {
    return {
      feedback:
        'You have used many iterations. Please wrap up your current task, send any final replies, and resolve the conversation if appropriate.',
    };
  }
}

/**
 * agents:agent-wake — Wake an agent for a conversation.
 * Debounced via singleton job key so rapid inbound messages produce one wake.
 * Thread ID uses agent-{agentId}-contact-{contactId} prefix, routing to
 * PostgresStore via VobaseMemoryStorage prefix rules (not the conversation thread).
 */
export const agentWakeJob = defineJob('agents:agent-wake', async (data) => {
  const { agentId, contactId, conversationId, trigger, payload } =
    wakeAgentSchema.parse(data);

  const deps = getModuleDeps();
  const { db } = deps;

  const start = Date.now();

  // Resolve agent
  const { getAgent } = await import('../mastra/agents');
  const registered = getAgent(agentId);
  if (!registered) {
    logger.error('[agent-wake] Agent not found', { agentId });
    return;
  }

  // Resolve channel type from conversation
  const [conversation] = await db
    .select({ channelInstanceId: conversations.channelInstanceId })
    .from(conversations)
    .where(eq(conversations.id, conversationId));

  let channelType = 'web';
  if (conversation?.channelInstanceId) {
    const [instance] = await db
      .select({ type: channelInstances.type })
      .from(channelInstances)
      .where(eq(channelInstances.id, conversation.channelInstanceId));
    if (instance?.type) channelType = instance.type;
  }

  // Format wake message based on trigger
  let wakeMessage: string;
  switch (trigger) {
    case 'inbound_message':
      wakeMessage = `New inbound message on conversation ${conversationId}. Read the conversation and respond.`;
      break;
    case 'scheduled_followup':
      wakeMessage = `Scheduled follow-up: ${(payload?.reason as string | undefined) ?? 'Check in with contact'}`;
      break;
    case 'supervisor':
      wakeMessage = `Supervisor instruction: ${(payload?.instruction as string | undefined) ?? 'Review conversation'}`;
      break;
    case 'manual':
      wakeMessage = `Manual wake: ${(payload?.reason as string | undefined) ?? 'Agent wake requested'}`;
      break;
  }

  // Build RequestContext matching what tools expect via context.requestContext.get('deps')
  const rc = new RequestContext();
  rc.set('conversationId', conversationId);
  rc.set('contactId', contactId);
  rc.set('agentId', agentId);
  rc.set('channel', channelType);
  rc.set('deps', deps);

  try {
    await registered.agent.generate([{ role: 'user', content: wakeMessage }], {
      memory: {
        thread: `agent-${agentId}-contact-${contactId}`,
        resource: `contact:${contactId}`,
      },
      maxSteps: 20,
      requestContext: rc,
      prepareStep: dynamicToolStep,
      onIterationComplete: iterationGuard,
      maxProcessorRetries: 1,
    });

    logger.info('[agent-wake] Agent wake completed', {
      trigger,
      agentId,
      contactId,
      conversationId,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    logger.error('[agent-wake] Agent generation failed', {
      trigger,
      agentId,
      contactId,
      conversationId,
      error: err,
    });
  }
});
