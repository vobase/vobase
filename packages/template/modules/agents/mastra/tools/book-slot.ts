import { createTool } from '@mastra/core/tools';
import { nanoid } from 'nanoid';
import { z } from 'zod';

/** Booking cost threshold (in cents) above which human approval is required. */
const APPROVAL_THRESHOLD_CENTS = 50000; // $500

/**
 * book_slot — Create a booking for a contact.
 * Suspends for human approval when the estimated cost exceeds the threshold.
 * Stub implementation returns a mock booking confirmation.
 */
export const bookSlotTool = createTool({
  id: 'book_slot',
  description:
    'Book an appointment slot for a contact. Always confirm the details with the customer before calling this tool. High-value bookings require human approval.',
  inputSchema: z.object({
    contactId: z.string().describe('ID of the contact making the booking'),
    service: z.string().describe('The service being booked'),
    datetime: z
      .string()
      .describe(
        'The selected slot datetime (ISO 8601, from check_availability)',
      ),
    estimatedCostCents: z
      .number()
      .int()
      .optional()
      .describe(
        'Estimated cost in cents (triggers approval if above threshold)',
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
    approvalRequired: z
      .boolean()
      .optional()
      .describe('Whether approval was required'),
  }),
  suspendSchema: z.object({
    bookingId: z.string(),
    service: z.string(),
    datetime: z.string(),
    estimatedCostCents: z.number(),
    contactId: z.string(),
    reason: z.string(),
  }),
  resumeSchema: z.object({
    approved: z.boolean(),
    approvedBy: z.string().optional(),
  }),
  execute: async (input, context) => {
    const cost = input.estimatedCostCents ?? 0;

    // Check if human approval is required for high-value bookings
    if (cost > APPROVAL_THRESHOLD_CENTS && context?.agent?.suspend) {
      // Check if we're resuming from a suspension
      if (context.agent.resumeData) {
        if (!context.agent.resumeData.approved) {
          return {
            bookingId: '',
            confirmed: false,
            datetime: input.datetime,
            approvalRequired: true,
          };
        }
        // Approved — proceed with booking
      } else {
        // Suspend for approval
        const bookingId = `BK-${nanoid(8).toUpperCase()}`;
        await context.agent.suspend({
          bookingId,
          service: input.service,
          datetime: input.datetime,
          estimatedCostCents: cost,
          contactId: input.contactId,
          reason: `Booking cost $${(cost / 100).toFixed(2)} exceeds approval threshold of $${(APPROVAL_THRESHOLD_CENTS / 100).toFixed(2)}`,
        });
        // After suspend, execution continues when resumed
        return {
          bookingId,
          confirmed: false,
          datetime: input.datetime,
          approvalRequired: true,
        };
      }
    }

    // Standard booking — no approval needed
    return {
      bookingId: `BK-${nanoid(8).toUpperCase()}`,
      confirmed: true,
      datetime: input.datetime,
    };
  },
});
