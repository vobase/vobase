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
  execute: async ({ service: _service, dateFrom, dateTo }) => {
    // Stub: generate realistic business-hour slots across the date range.
    // Uses UTC hours directly so times display correctly regardless of server timezone.
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    const slots: Array<{ datetime: string; available: boolean }> = [];
    const businessHours = [9, 10, 11, 13, 14, 15, 16]; // 9am-11am, 1pm-4pm (lunch break 12-1)

    const current = new Date(from);
    current.setUTCHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setUTCHours(23, 59, 59, 999);

    while (current <= end && slots.length < 20) {
      const dayOfWeek = current.getUTCDay();
      // Skip weekends
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        for (const hour of businessHours) {
          const dt = new Date(current);
          dt.setUTCHours(hour, 0, 0, 0);
          if (dt >= from && dt <= end) {
            // Semi-random availability based on hour + day
            const available = (hour + dayOfWeek) % 3 !== 0;
            slots.push({ datetime: dt.toISOString(), available });
          }
        }
      }
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return { slots };
  },
});
