import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * cancel_booking — Cancel an existing booking.
 * Stub implementation returns success.
 * Replace with real booking system integration.
 */
export const cancelBookingTool = createTool({
  id: 'cancel_booking',
  description:
    'Cancel an existing booking by its booking ID. Confirm the cancellation with the customer before calling this tool.',
  inputSchema: z.object({
    bookingId: z.string().describe('The booking reference ID to cancel'),
    reason: z.string().optional().describe('Optional reason for cancellation'),
  }),
  outputSchema: z.object({
    cancelled: z
      .boolean()
      .describe('Whether the booking was successfully cancelled'),
  }),
  execute: async () => {
    // Stub: always return success
    return { cancelled: true };
  },
});
