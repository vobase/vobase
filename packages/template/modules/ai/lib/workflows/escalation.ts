import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

/**
 * Escalation workflow — HITL pattern using Mastra suspend/resume.
 *
 * Step 1: analyzeEscalation — prepares a summary of why escalation is needed
 * Step 2: humanApproval — suspends workflow, waits for human decision
 * Step 3: executeEscalation — acts on the human's decision
 *
 * Runtime state is tracked externally in the aiWorkflowRuns table because
 * Mastra workflows are in-memory without a Mastra class storage backend.
 */

const escalationInputSchema = z.object({
  threadId: z.string(),
  reason: z.string(),
});

const escalationOutputSchema = z.object({
  escalated: z.boolean(),
  note: z.string().optional(),
});

export type EscalationInput = z.infer<typeof escalationInputSchema>;
export type EscalationOutput = z.infer<typeof escalationOutputSchema>;

/** Step 1: Analyze the escalation request and prepare a summary. */
export const analyzeStep = createStep({
  id: 'analyze-escalation',
  inputSchema: escalationInputSchema,
  outputSchema: z.object({
    threadId: z.string(),
    reason: z.string(),
    summary: z.string(),
  }),
  execute: async ({ inputData }) => {
    return {
      threadId: inputData.threadId,
      reason: inputData.reason,
      summary: `Escalation requested for thread ${inputData.threadId}: ${inputData.reason}`,
    };
  },
});

/** Step 2: Suspend for human approval. */
export const approvalStep = createStep({
  id: 'human-approval',
  inputSchema: z.object({
    threadId: z.string(),
    reason: z.string(),
    summary: z.string(),
  }),
  outputSchema: z.object({
    approved: z.boolean(),
    note: z.string().optional(),
    threadId: z.string(),
  }),
  suspendSchema: z.object({
    reason: z.string(),
    threadId: z.string(),
    summary: z.string(),
  }),
  resumeSchema: z.object({
    approved: z.boolean(),
    note: z.string().optional(),
  }),
  execute: async ({ inputData, suspend, resumeData }) => {
    // If we have resume data, the human has responded
    if (resumeData) {
      return {
        approved: resumeData.approved,
        note: resumeData.note,
        threadId: inputData.threadId,
      };
    }

    // Suspend and wait for human decision
    await suspend({
      reason: inputData.reason,
      threadId: inputData.threadId,
      summary: inputData.summary,
    });

    // Unreachable — suspend halts execution
    return { approved: false, threadId: inputData.threadId };
  },
});

/** Step 3: Execute the escalation decision. */
export const executeStep = createStep({
  id: 'execute-escalation',
  inputSchema: z.object({
    approved: z.boolean(),
    note: z.string().optional(),
    threadId: z.string(),
  }),
  outputSchema: escalationOutputSchema,
  execute: async ({ inputData }) => {
    if (inputData.approved) {
      return {
        escalated: true,
        note: inputData.note ?? 'Escalation approved by human reviewer.',
      };
    }
    return {
      escalated: false,
      note: inputData.note ?? 'Escalation rejected by human reviewer.',
    };
  },
});

/**
 * The escalation workflow definition.
 * Showcases Mastra's createWorkflow + createStep + suspend/resume pattern.
 */
export const escalationWorkflow = createWorkflow({
  id: 'ai:escalation',
  inputSchema: escalationInputSchema,
  outputSchema: escalationOutputSchema,
})
  .then(analyzeStep)
  .then(approvalStep)
  .then(executeStep)
  .commit();
