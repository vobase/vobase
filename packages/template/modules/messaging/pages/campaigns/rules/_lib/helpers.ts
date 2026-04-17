export type StatusVariant =
  | 'default'
  | 'success'
  | 'warning'
  | 'error'
  | 'info';

export function ruleStatusVariant(isActive: boolean): StatusVariant {
  return isActive ? 'success' : 'default';
}

export function executionStatusVariant(status: string): StatusVariant {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'error';
  if (status === 'running') return 'info';
  return 'default';
}

export function ruleTypeLabel(type: string): string {
  switch (type) {
    case 'recurring':
      return 'Recurring';
    case 'date-relative':
      return 'Date-relative';
    default:
      return type;
  }
}

const DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function formatTimeOfDay(hhmm: string | null | undefined): string {
  if (!hhmm) return '';
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const suffix = h < 12 ? 'AM' : 'PM';
  const mm = m.toString().padStart(2, '0');
  return `${h12}:${mm} ${suffix}`;
}

export function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Translate a 5-field cron expression into natural English. Falls back to
 *  the raw cron string if the pattern isn't recognized. */
export function cronToHuman(cron: string | null | undefined): string {
  if (!cron) return '—';
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [minStr, hourStr, domStr, monStr, dowStr] = parts;

  if (
    minStr === '*' &&
    hourStr === '*' &&
    domStr === '*' &&
    monStr === '*' &&
    dowStr === '*'
  ) {
    return 'Every minute';
  }

  const everyNMinutes = minStr.match(/^\*\/(\d+)$/);
  if (
    everyNMinutes &&
    hourStr === '*' &&
    domStr === '*' &&
    monStr === '*' &&
    dowStr === '*'
  ) {
    return `Every ${everyNMinutes[1]} minutes`;
  }

  if (
    minStr === '0' &&
    hourStr === '*' &&
    domStr === '*' &&
    monStr === '*' &&
    dowStr === '*'
  ) {
    return 'Every hour';
  }

  const minute = Number(minStr);
  const hour = Number(hourStr);
  if (!Number.isFinite(minute) || !Number.isFinite(hour)) return cron;
  const time = formatTimeOfDay(
    `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
  );

  // Daily
  if (domStr === '*' && monStr === '*' && dowStr === '*') {
    return `Every day at ${time}`;
  }

  // Weekdays / weekends shortcuts
  if (domStr === '*' && monStr === '*' && dowStr === '1-5') {
    return `Every weekday at ${time}`;
  }
  if (
    domStr === '*' &&
    monStr === '*' &&
    (dowStr === '0,6' || dowStr === '6,0')
  ) {
    return `Every weekend at ${time}`;
  }

  // Single day of week
  if (domStr === '*' && monStr === '*' && /^\d+$/.test(dowStr)) {
    const idx = Number(dowStr);
    if (idx >= 0 && idx <= 6) return `Every ${DAYS[idx]} at ${time}`;
  }

  // List of days of week
  if (domStr === '*' && monStr === '*' && /^\d+(?:,\d+)+$/.test(dowStr)) {
    const names = dowStr
      .split(',')
      .map((d) => DAYS[Number(d)])
      .filter(Boolean);
    if (names.length > 1) {
      const list = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
      return `Every ${list} at ${time}`;
    }
  }

  // Monthly on a specific day
  if (/^\d+$/.test(domStr) && monStr === '*' && dowStr === '*') {
    return `Monthly on the ${ordinal(Number(domStr))} at ${time}`;
  }

  return cron;
}
