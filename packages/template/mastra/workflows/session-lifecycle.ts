import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

/**
 * Conversation lifecycle workflow — placeholder for the E→S conversation state machine.
 *
 * Steps: start-conversation → process → complete
 *
 * This is the foundation for tracking booking conversation state:
 * a conversation starts when a contact initiates, progresses through agent
 * interactions, and completes when the booking is confirmed or the
 * customer ends the conversation.
 */

const conversationInputSchema = z.object({
  conversationId: z.string(),
  contactId: z.string(),
  channel: z.enum(['whatsapp', 'web']),
});

const conversationOutputSchema = z.object({
  conversationId: z.string(),
  status: z.enum(['completed', 'abandoned']),
});

/** Step 1: Initialize the conversation. */
const startConversationStep = createStep({
  id: 'start-conversation',
  inputSchema: conversationInputSchema,
  outputSchema: z.object({
    conversationId: z.string(),
    contactId: z.string(),
    channel: z.enum(['whatsapp', 'web']),
    startedAt: z.string(),
  }),
  execute: async ({ inputData }) => {
    return {
      conversationId: inputData.conversationId,
      contactId: inputData.contactId,
      channel: inputData.channel,
      startedAt: new Date().toISOString(),
    };
  },
});

/** Step 2: Process the conversation (agent interactions happen here). */
const processStep = createStep({
  id: 'process',
  inputSchema: z.object({
    conversationId: z.string(),
    contactId: z.string(),
    channel: z.enum(['whatsapp', 'web']),
    startedAt: z.string(),
  }),
  outputSchema: z.object({
    conversationId: z.string(),
    resolved: z.boolean(),
  }),
  execute: async ({ inputData }) => {
    return {
      conversationId: inputData.conversationId,
      resolved: true,
    };
  },
});

/** Step 3: Complete the conversation. */
const completeStep = createStep({
  id: 'complete',
  inputSchema: z.object({
    conversationId: z.string(),
    resolved: z.boolean(),
  }),
  outputSchema: conversationOutputSchema,
  execute: async ({ inputData }) => {
    return {
      conversationId: inputData.conversationId,
      status: inputData.resolved
        ? ('completed' as const)
        : ('abandoned' as const),
    };
  },
});

/** Metadata for the UI — co-located with the workflow definition. */
export const conversationLifecycleMeta = {
  id: 'ai:conversation-lifecycle',
  name: 'Conversation Lifecycle',
  description:
    'Tracks the lifecycle of a booking conversation from start to completion',
  steps: [
    {
      id: 'start-conversation',
      name: 'Start Conversation',
      description: 'Initializes the conversation',
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
      description: 'Finalizes the conversation status',
      type: 'action' as const,
    },
  ],
};

export const conversationLifecycleWorkflow = createWorkflow({
  id: 'ai:conversation-lifecycle',
  inputSchema: conversationInputSchema,
  outputSchema: conversationOutputSchema,
})
  .then(startConversationStep)
  .then(processStep)
  .then(completeStep)
  .commit();
