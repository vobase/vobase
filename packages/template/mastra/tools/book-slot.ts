import { createTool } from '@mastra/core/tools';
import { nanoid } from 'nanoid';
import { z } from 'zod';

/**
 * book_slot — Create a booking for a contact.
 * Stub implementation returns a mock booking confirmation.
 * Replace with real booking system integration.
 */
export const bookSlotTool = createTool({
  id: 'book_slot',
  description:
    'Book an appointment slot for a contact. Always confirm the details with the customer before calling this tool.',
  inputSchema: z.object({
    contactId: z.string().describe('ID of the contact making the booking'),
    service: z.string().describe('The service being booked'),
    datetime: z
      .string()
      .describe(
        'The selected slot datetime (ISO 8601, from check_availability)',
      ),
    notes: z
      .string()
      .optional()
      .describe('Optional notes or special requests from the customer'),
  }),
  outputSchema: z.object({
    bookingId: z.string().describe('Unique booking reference ID'),
    confirmed: z.boolean().describe('Whether the booking was confirmed'),
    datetime: z.string().describe('Confirmed booking datetime (ISO 8601)'),
  }),
  execute: async ({ datetime }) => {
    // Stub: return mock booking confirmation
    return {
      bookingId: `BK-${nanoid(8).toUpperCase()}`,
      confirmed: true,
      datetime,
    };
  },
});
