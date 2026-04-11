import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import type { ModuleDeps } from '../../modules/ai/lib/deps';
import { getModuleDeps } from '../../modules/ai/lib/deps';
import { transition } from '../../modules/ai/lib/state-machine';
import { resolveTarget } from './_resolve-target';

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

export const reassignTool = createTool({
  id: 'reassign',
  description:
    'Reassign this conversation to a staff member, role, or agent. Use when the conversation should be handled by someone else.',
  inputSchema: z.object({
    target: z.object({
      type: z
        .enum(['role', 'user', 'agent'])
        .describe(
          '"role" to resolve by role name, "user" for a specific userId, "agent" to route back to an AI agent',
        ),
      value: z.string().describe('Role name, userId, or agent ID'),
    }),
    reason: z.string().describe('Why the conversation is being reassigned'),
    priority: z
      .enum(PRIORITIES)
      .optional()
      .describe('Priority level for the new assignee'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (input, context) => {
    const deps =
      (context?.requestContext?.get('deps') as ModuleDeps | undefined) ??
      getModuleDeps();
    const { db } = deps;

    const conversationId =
      (context?.requestContext?.get('conversationId') as string | undefined) ??
      '';

    if (!conversationId) {
      return { success: false, message: 'No conversation context available' };
    }

    const resolvedAssignee = await resolveTarget(db, input.target);
    if (!resolvedAssignee) {
      return {
        success: false,
        message: `Could not resolve target: ${input.target.type}=${input.target.value}`,
      };
    }

    const result = await transition(deps, conversationId, {
      type: 'REASSIGN',
      assignee: resolvedAssignee,
      reason: input.reason,
    });

    if (!result.ok) {
      return { success: false, message: result.error };
    }

    return {
      success: true,
      message: `Conversation reassigned to ${resolvedAssignee}.`,
    };
  },
});
