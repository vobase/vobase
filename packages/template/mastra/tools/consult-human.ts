import { createTool } from '@mastra/core/tools';
import { logger } from '@vobase/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { requestConsultation } from '../../modules/ai/lib/consult-human';
import type { ModuleDeps } from '../../modules/ai/lib/deps';
import {
  getModuleChannels,
  getModuleDb,
  getModuleDeps,
  getModuleScheduler,
} from '../../modules/ai/lib/deps';
import { contacts } from '../../modules/ai/schema';

export const consultHumanTool = createTool({
  id: 'consult_human',
  description:
    'Request a specific action from a human team member. Only use this AFTER you have exhausted all available tools (search_knowledge_base, check_availability, etc.) and still cannot resolve the issue. The request must include a concrete, actionable task for the human — not a vague "please help". Examples: "Verify the refund of $50 was processed for order #1234", "Confirm the physical room setup for tomorrow 3pm booking", "Approve a 20% discount for returning customer". The interaction continues normally while staff works on it.',
  inputSchema: z.object({
    reason: z
      .string()
      .describe('Why human consultation is needed (shown to the operator)'),
    message: z
      .string()
      .describe(
        'Summary of the situation and what the operator needs to decide or do',
      ),
  }),
  outputSchema: z.object({
    consultationId: z
      .string()
      .describe('Unique ID for this consultation request'),
    status: z
      .enum(['pending', 'error'])
      .describe('Consultation status after creation'),
    error: z.string().optional().describe('Error message if creation failed'),
  }),
  execute: async ({ reason, message }, context) => {
    const rcDeps = context?.requestContext?.get('deps') as
      | ModuleDeps
      | undefined;
    const db = rcDeps?.db ?? getModuleDb();
    const channels = rcDeps?.channels ?? getModuleChannels();
    const scheduler = rcDeps?.scheduler ?? getModuleScheduler();
    const interactionId =
      (context?.requestContext?.get('interactionId') as string | undefined) ??
      '';

    if (!interactionId) {
      return {
        consultationId: '',
        status: 'error' as const,
        error: 'No interaction context available',
      };
    }

    try {
      const staffContacts = await db
        .select()
        .from(contacts)
        .where(eq(contacts.role, 'staff'))
        .limit(1);

      if (staffContacts.length === 0) {
        logger.warn('[consult-human] No staff contacts found for consultation');
        return {
          consultationId: '',
          status: 'error' as const,
          error: 'No staff contacts available',
        };
      }

      const staffContact = staffContacts[0];
      const channel = staffContact.phone ? 'whatsapp' : 'email';

      const consultation = await requestConsultation(
        { db, scheduler, channels, realtime: getModuleDeps().realtime },
        {
          interactionId,
          staffContactId: staffContact.id,
          channelType: channel,
          reason,
          message,
        },
      );

      return {
        consultationId: consultation.id,
        status: 'pending' as const,
      };
    } catch (err) {
      logger.error('[consult-human] Failed to create consultation', {
        interactionId,
        error: err,
      });
      return {
        consultationId: '',
        status: 'error' as const,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  },
});
