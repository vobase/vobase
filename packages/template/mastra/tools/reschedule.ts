import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * reschedule_booking — Move an existing booking to a new datetime.
 * Stub implementation returns a mock confirmation.
 * Replace with real booking system integration.
 */
export const rescheduleBookingTool = createTool({
  id: 'reschedule_booking',
  description:
    'Reschedule an existing booking to a new datetime. Use check_availability first to confirm the new slot is open.',
  inputSchema: z.object({
    bookingId: z.string().describe('The booking reference ID to reschedule'),
    newDatetime: z
      .string()
      .describe('The new slot datetime (ISO 8601, from check_availability)'),
  }),
  outputSchema: z.object({
    bookingId: z.string().describe('The booking reference ID'),
    confirmed: z.boolean().describe('Whether the reschedule was confirmed'),
    newDatetime: z.string().describe('The confirmed new datetime (ISO 8601)'),
  }),
  execute: async ({ bookingId, newDatetime }) => {
    // Stub: return mock reschedule confirmation
    return {
      bookingId,
      confirmed: true,
      newDatetime,
    };
  },
});
