import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

/**
 * Follow-up workflow — automated delayed follow-up message.
 *
 * Step 1: analyzeConversation — summarize conversation, identify follow-up needs
 * Step 2: scheduleFollowUp — suspend workflow; a delayed job resumes it
 * Step 3: sendFollowUp — compose and queue the follow-up message
 *
 * Runtime state is tracked externally in the aiWorkflowRuns table.
 * The "schedule" step suspends the workflow. The route handler queues a
 * delayed job (ai:follow-up-resume) which resumes execution after the delay.
 */

const followUpInputSchema = z.object({
  conversationId: z.string(),
  delayMinutes: z.number(),
});

const followUpOutputSchema = z.object({
  sent: z.boolean(),
  message: z.string().optional(),
});

export type FollowUpInput = z.infer<typeof followUpInputSchema>;
export type FollowUpOutput = z.infer<typeof followUpOutputSchema>;

/** Step 1: Analyze the conversation for follow-up needs. */
export const analyzeConversationStep = createStep({
  id: 'analyze-conversation',
  inputSchema: followUpInputSchema,
  outputSchema: z.object({
    conversationId: z.string(),
    delayMinutes: z.number(),
    summary: z.string(),
  }),
  execute: async ({ inputData }) => {
    return {
      conversationId: inputData.conversationId,
      delayMinutes: inputData.delayMinutes,
      summary: `Follow-up scheduled for conversation ${inputData.conversationId} in ${inputData.delayMinutes} minutes.`,
    };
  },
});

/** Step 2: Schedule follow-up by suspending the workflow. */
export const scheduleFollowUpStep = createStep({
  id: 'schedule-follow-up',
  inputSchema: z.object({
    conversationId: z.string(),
    delayMinutes: z.number(),
    summary: z.string(),
  }),
  outputSchema: z.object({
    conversationId: z.string(),
    ready: z.boolean(),
  }),
  suspendSchema: z.object({
    conversationId: z.string(),
    delayMinutes: z.number(),
    scheduledAt: z.string(),
  }),
  resumeSchema: z.object({
    ready: z.boolean(),
  }),
  execute: async ({ inputData, suspend, resumeData }) => {
    if (resumeData) {
      return {
        conversationId: inputData.conversationId,
        ready: resumeData.ready,
      };
    }

    await suspend({
      conversationId: inputData.conversationId,
      delayMinutes: inputData.delayMinutes,
      scheduledAt: new Date(
        Date.now() + inputData.delayMinutes * 60_000,
      ).toISOString(),
    });

    return { conversationId: inputData.conversationId, ready: false };
  },
});

/** Step 3: Send the follow-up message. */
export const sendFollowUpStep = createStep({
  id: 'send-follow-up',
  inputSchema: z.object({
    conversationId: z.string(),
    ready: z.boolean(),
  }),
  outputSchema: followUpOutputSchema,
  execute: async ({ inputData }) => {
    if (!inputData.ready) {
      return { sent: false, message: 'Follow-up not ready.' };
    }

    // In a production implementation, this would compose an AI message
    // and queue it via queueOutboundMessage. For this showcase, we
    // mark it as sent with a placeholder message.
    return {
      sent: true,
      message: `Follow-up sent for conversation ${inputData.conversationId}.`,
    };
  },
});

/**
 * The follow-up workflow definition.
 * Showcases Mastra's delayed execution pattern via suspend + external job resume.
 */
/** Metadata for the UI — co-located with the workflow definition. */
export const followUpMeta = {
  id: 'ai:follow-up',
  name: 'Follow-up',
  description:
    'Delayed workflow — schedules a follow-up message after a configurable delay',
  steps: [
    {
      id: 'analyze-conversation',
      name: 'Analyze Conversation',
      description: 'Summarizes conversation and identifies follow-up needs',
      type: 'action' as const,
    },
    {
      id: 'schedule-follow-up',
      name: 'Schedule',
      description: 'Suspends workflow, queues delayed resume job',
      type: 'suspend' as const,
    },
    {
      id: 'send-follow-up',
      name: 'Send Follow-up',
      description: 'Composes and queues the follow-up message',
      type: 'action' as const,
    },
  ],
};

export const followUpWorkflow = createWorkflow({
  id: 'ai:follow-up',
  inputSchema: followUpInputSchema,
  outputSchema: followUpOutputSchema,
})
  .then(analyzeConversationStep)
  .then(scheduleFollowUpStep)
  .then(sendFollowUpStep)
  .commit();
