import { createTool } from '@mastra/core/tools';
import { logger } from '@vobase/core';
import { z } from 'zod';

import { createTask } from '../../modules/automation/lib/tasks';

export const createBrowserTaskTool = createTool({
  id: 'create_browser_task',
  description:
    'Queue a browser automation task for a staff member to execute. ' +
    'Use this to trigger actions in web applications that have no API, ' +
    'such as creating WhatsApp groups or filling forms in legacy systems. ' +
    'The task will be picked up by a staff member with the TamperMonkey script installed.',
  inputSchema: z.object({
    adapterId: z.string().describe('The adapter ID (e.g., "whatsapp")'),
    action: z.string().describe('The action to execute (e.g., "createGroup")'),
    input: z
      .record(z.string(), z.unknown())
      .describe('Input data for the action'),
    assignTo: z
      .string()
      .optional()
      .describe('User ID of the staff member to assign to'),
    timeoutMinutes: z
      .number()
      .default(10)
      .describe('Minutes to wait before timing out'),
  }),
  outputSchema: z.object({
    taskId: z.string(),
    status: z.enum(['pending', 'error']),
    error: z.string().optional(),
  }),
  execute: async ({ adapterId, action, input, assignTo, timeoutMinutes }) => {
    try {
      const task = await createTask({
        adapterId,
        action,
        input: input as Record<string, unknown>,
        assignedTo: assignTo,
        requestedBy: 'ai',
        requiresApproval: true,
        timeoutMinutes,
      });

      return { taskId: task.id, status: 'pending' as const };
    } catch (err) {
      logger.error('[create_browser_task] Failed to create task', {
        error: err,
      });
      return {
        taskId: '',
        status: 'error' as const,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  },
});
