import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * check_availability — Query available time slots for a service.
 * Stub implementation returns mock availability data.
 * Replace with real calendar/booking system integration.
 */
export const checkAvailabilityTool = createTool({
  id: 'check_availability',
  description:
    'Check available time slots for a service within a date range. Use this before booking to show customers their options.',
  inputSchema: z.object({
    service: z.string().describe('The service type to check availability for'),
    dateFrom: z
      .string()
      .describe('Start of date range (ISO 8601, e.g. 2024-03-25T00:00:00Z)'),
    dateTo: z
      .string()
      .describe('End of date range (ISO 8601, e.g. 2024-03-27T00:00:00Z)'),
  }),
  outputSchema: z.object({
    slots: z.array(
      z.object({
        datetime: z.string().describe('ISO 8601 datetime of the slot'),
        available: z.boolean().describe('Whether this slot is available'),
      }),
    ),
  }),
  execute: async ({ service, dateFrom }) => {
    // Stub: generate mock slots starting from dateFrom
    const base = new Date(dateFrom);
    const slots = Array.from({ length: 6 }, (_, i) => {
      const dt = new Date(base);
      dt.setHours(9 + i * 1, 0, 0, 0);
      return {
        datetime: dt.toISOString(),
        available: i % 3 !== 1, // mock pattern: every 3rd slot unavailable
      };
    });

    return { slots };
  },
});
