import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

/**
 * Session lifecycle workflow — placeholder for the E→S session state machine.
 *
 * Steps: start-session → process → complete
 *
 * This is the foundation for tracking booking session state:
 * a session starts when a contact initiates, progresses through agent
 * interactions, and completes when the booking is confirmed or the
 * customer ends the conversation.
 */

const sessionInputSchema = z.object({
  sessionId: z.string(),
  contactId: z.string(),
  channel: z.enum(['whatsapp', 'web']),
});

const sessionOutputSchema = z.object({
  sessionId: z.string(),
  status: z.enum(['completed', 'abandoned']),
});

/** Step 1: Initialize the session. */
const startSessionStep = createStep({
  id: 'start-session',
  inputSchema: sessionInputSchema,
  outputSchema: z.object({
    sessionId: z.string(),
    contactId: z.string(),
    channel: z.enum(['whatsapp', 'web']),
    startedAt: z.string(),
  }),
  execute: async ({ inputData }) => {
    return {
      sessionId: inputData.sessionId,
      contactId: inputData.contactId,
      channel: inputData.channel,
      startedAt: new Date().toISOString(),
    };
  },
});

/** Step 2: Process the session (agent interactions happen here). */
const processStep = createStep({
  id: 'process',
  inputSchema: z.object({
    sessionId: z.string(),
    contactId: z.string(),
    channel: z.enum(['whatsapp', 'web']),
    startedAt: z.string(),
  }),
  outputSchema: z.object({
    sessionId: z.string(),
    resolved: z.boolean(),
  }),
  execute: async ({ inputData }) => {
    return {
      sessionId: inputData.sessionId,
      resolved: true,
    };
  },
});

/** Step 3: Complete the session. */
const completeStep = createStep({
  id: 'complete',
  inputSchema: z.object({
    sessionId: z.string(),
    resolved: z.boolean(),
  }),
  outputSchema: sessionOutputSchema,
  execute: async ({ inputData }) => {
    return {
      sessionId: inputData.sessionId,
      status: inputData.resolved
        ? ('completed' as const)
        : ('abandoned' as const),
    };
  },
});

/** Metadata for the UI — co-located with the workflow definition. */
export const sessionLifecycleMeta = {
  id: 'ai:session-lifecycle',
  name: 'Session Lifecycle',
  description:
    'Tracks the lifecycle of a booking session from start to completion',
  steps: [
    {
      id: 'start-session',
      name: 'Start Session',
      description: 'Initializes the session',
      type: 'action' as const,
    },
    {
      id: 'process',
      name: 'Process',
      description: 'Agent interactions and booking logic',
      type: 'action' as const,
    },
    {
      id: 'complete',
      name: 'Complete',
      description: 'Finalizes the session status',
      type: 'action' as const,
    },
  ],
};

export const sessionLifecycleWorkflow = createWorkflow({
  id: 'ai:session-lifecycle',
  inputSchema: sessionInputSchema,
  outputSchema: sessionOutputSchema,
})
  .then(startSessionStep)
  .then(processStep)
  .then(completeStep)
  .commit();
