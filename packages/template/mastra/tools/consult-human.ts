import { createTool } from '@mastra/core/tools';
import { logger } from '@vobase/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { contacts } from '../../modules/contacts/schema';
import { requestConsultation } from '../../modules/conversations/lib/consult-human';
import {
  getModuleChannels,
  getModuleDb,
  getModuleScheduler,
} from '../lib/deps';

/**
 * consult_human — Escalate to a human operator for a given session.
 * Creates a consultation record in the DB and notifies staff via channels.
 */
export const consultHumanTool = createTool({
  id: 'consult_human',
  description:
    'Request human operator assistance for a session. Use when the customer has an issue that requires human judgment, approval, or intervention.',
  inputSchema: z.object({
    sessionId: z.string().describe('The current conversation session ID'),
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
  execute: async ({ sessionId, reason, message }) => {
    const db = getModuleDb();
    const channels = getModuleChannels();
    const scheduler = getModuleScheduler();

    try {
      // Find the first available staff contact to route to
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
      // Determine channel: prefer whatsapp if staff has phone, else email
      const channel = staffContact.phone ? 'whatsapp' : 'email';

      const consultation = await requestConsultation(
        { db, scheduler, channels },
        {
          sessionId,
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
        sessionId,
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
