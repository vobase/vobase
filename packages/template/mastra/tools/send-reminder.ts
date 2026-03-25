import { createTool } from '@mastra/core/tools';
import { logger } from '@vobase/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { contacts } from '../../modules/contacts/schema';
import { getModuleChannels, getModuleDb } from '../lib/deps';

/**
 * send_reminder — Send a reminder message to a contact via their preferred channel.
 * Uses core _channels service wired via setAiModuleDeps().
 */
export const sendReminderTool = createTool({
  id: 'send_reminder',
  description:
    'Send a reminder message to a contact via WhatsApp or email. Use for appointment reminders or follow-ups.',
  inputSchema: z.object({
    contactId: z.string().describe('ID of the contact to remind'),
    channel: z
      .enum(['whatsapp', 'email'])
      .describe('Channel to send the reminder through'),
    message: z.string().describe('The reminder message text'),
  }),
  outputSchema: z.object({
    sent: z.boolean().describe('Whether the reminder was sent'),
    messageId: z
      .string()
      .optional()
      .describe('Message ID from the channel provider'),
    error: z.string().optional().describe('Error message if send failed'),
  }),
  execute: async ({ contactId, channel, message }) => {
    const db = getModuleDb();
    const channels = getModuleChannels();

    // Look up contact for delivery address
    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, contactId));

    if (!contact) {
      return { sent: false, error: 'Contact not found' };
    }

    try {
      if (channel === 'whatsapp') {
        if (!contact.phone) {
          return { sent: false, error: 'Contact has no phone number' };
        }
        const result = await channels.whatsapp.send({
          to: contact.phone,
          text: message,
        });
        return {
          sent: result.success,
          messageId: result.messageId,
          ...(!result.success && { error: result.error }),
        };
      }

      if (channel === 'email') {
        if (!contact.email) {
          return { sent: false, error: 'Contact has no email address' };
        }
        const result = await channels.email.send({
          to: contact.email,
          subject: 'Reminder',
          html: `<p>${message}</p>`,
        });
        return {
          sent: result.success,
          messageId: result.messageId,
          ...(!result.success && { error: result.error }),
        };
      }

      return { sent: false, error: `Unsupported channel: ${channel}` };
    } catch (err) {
      logger.error('[send-reminder] Failed to send', {
        contactId,
        channel,
        error: err,
      });
      return {
        sent: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  },
});
