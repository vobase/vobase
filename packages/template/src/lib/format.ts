import { formatDistanceToNowStrict } from 'date-fns';

/** Relative time string (e.g. "2 minutes ago", "3 hours ago") */
export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return formatDistanceToNowStrict(d, { addSuffix: true });
}

/** Short relative time (e.g. "now", "5m", "3h", "2d") — no "ago" suffix */
export function formatRelativeTimeShort(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function formatDate(
  date: Date | string | number | undefined,
  opts: Intl.DateTimeFormatOptions = {},
) {
  if (!date) return '';

  try {
    return new Intl.DateTimeFormat('en-US', {
      month: opts.month ?? 'long',
      day: opts.day ?? 'numeric',
      year: opts.year ?? 'numeric',
      ...opts,
    }).format(new Date(date));
  } catch (_err) {
    return '';
  }
}

/** Short date + time (e.g. "Apr 10, 03:45 PM") */
export function formatDateTime(date: Date | string | number | undefined) {
  if (!date) return '';
  return formatDate(date, {
    month: 'short',
    day: 'numeric',
    year: undefined,
    hour: '2-digit',
    minute: '2-digit',
  });
}
