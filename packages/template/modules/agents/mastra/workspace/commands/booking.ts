/**
 * Booking commands — stub implementations for slot checking, booking,
 * rescheduling, and cancellation. Replace with real booking system integration.
 */
import { nanoid } from 'nanoid';

import { type CommandHandler, err, ok } from './types';

/** Weekday hours: 9am-11am, 1pm-4pm (lunch break 12-1). Saturday: 9am-12pm. */
const WEEKDAY_HOURS = [9, 10, 11, 13, 14, 15, 16];
const SATURDAY_HOURS = [9, 10, 11];

/** Format hour as 12h display (e.g. 9 → "9:00 AM", 14 → "2:00 PM"). */
function formatHour(hour: number): string {
  const h = hour > 12 ? hour - 12 : hour;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  return `${h}:00 ${ampm}`;
}

/**
 * `vobase check-slots <date> [--service <s>]`
 *
 * Generate realistic business-hour slots for a given date.
 * Stub: semi-random availability based on hour + day-of-week.
 */
export const checkSlots: CommandHandler = async (positional, flags) => {
  const dateStr = positional[0];
  if (!dateStr) {
    return err('Usage: vobase check-slots <date> [--service <service>]');
  }

  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return err(`Invalid date: ${dateStr}`);
  }

  const dayOfWeek = date.getUTCDay();
  if (dayOfWeek === 0) {
    return ok(
      `Available slots for ${dateStr}:\n(no slots — closed on Sundays)`,
    );
  }

  const service = flags.service;
  const header = service
    ? `Available slots for ${dateStr} (${service}):`
    : `Available slots for ${dateStr}:`;

  const hours = dayOfWeek === 6 ? SATURDAY_HOURS : WEEKDAY_HOURS;
  const lines = hours.map((hour) => {
    // Semi-random availability based on hour + day
    const available = (hour + dayOfWeek) % 3 !== 0;
    const mark = available ? '✓' : '✗';
    return `  ${formatHour(hour)} ${mark}`;
  });

  return ok(`${header}\n${lines.join('\n')}`);
};

/**
 * `vobase book <datetime> --service <s> [--notes <n>]`
 *
 * Create a booking. Stub: generates a booking ID and returns confirmation.
 */
export const book: CommandHandler = async (positional, flags) => {
  const datetime = positional[0];
  if (!datetime) {
    return err(
      'Usage: vobase book <datetime> --service <service> [--notes <notes>]',
    );
  }

  const service = flags.service;
  if (!service) {
    return err('Missing required flag: --service <service>');
  }

  const date = new Date(datetime);
  if (Number.isNaN(date.getTime())) {
    return err(`Invalid datetime: ${datetime}`);
  }

  const bookingId = `BK-${nanoid(8).toUpperCase()}`;
  const notes = flags.notes;
  const notesLine = notes ? `\nNotes: ${notes}` : '';

  return ok(`Booked: ${bookingId} — ${service} at ${datetime}${notesLine}`);
};

/**
 * `vobase reschedule <bookingId> <datetime>`
 *
 * Reschedule an existing booking to a new datetime.
 */
export const reschedule: CommandHandler = async (positional) => {
  const bookingId = positional[0];
  const newDatetime = positional[1];

  if (!bookingId || !newDatetime) {
    return err('Usage: vobase reschedule <bookingId> <datetime>');
  }

  const date = new Date(newDatetime);
  if (Number.isNaN(date.getTime())) {
    return err(`Invalid datetime: ${newDatetime}`);
  }

  return ok(`Rescheduled: ${bookingId} → ${newDatetime}`);
};

/**
 * `vobase cancel <bookingId> [--reason <reason>]`
 *
 * Cancel an existing booking.
 */
export const cancelBooking: CommandHandler = async (positional, flags) => {
  const bookingId = positional[0];

  if (!bookingId) {
    return err('Usage: vobase cancel <bookingId> [--reason <reason>]');
  }

  const reason = flags.reason;
  const reasonLine = reason ? ` (${reason})` : '';

  return ok(`Cancelled: ${bookingId}${reasonLine}`);
};

/** All booking commands keyed by their subcommand name. */
export const bookingCommands: Record<string, CommandHandler> = {
  'check-slots': checkSlots,
  book,
  reschedule,
  cancel: cancelBooking,
};
