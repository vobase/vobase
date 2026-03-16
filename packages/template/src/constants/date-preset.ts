import type { DatePreset } from '@/components/data-table/types';

// NOTE: `now` is captured at module-load time. In long-lived browser tabs,
// presets like "Today" become stale after midnight. If this becomes an issue,
// switch to a factory function that computes dates on each render.
const now = new Date();

function daysAgo(days: number): Date {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfToday(): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfToday(): Date {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d;
}

export const presets: DatePreset[] = [
  { label: 'Today', shortcut: 't', from: startOfToday(), to: endOfToday() },
  { label: 'Last 7 days', shortcut: 'w', from: daysAgo(7), to: endOfToday() },
  {
    label: 'Last 30 days',
    shortcut: 'm',
    from: daysAgo(30),
    to: endOfToday(),
  },
  {
    label: 'Last 90 days',
    shortcut: 'q',
    from: daysAgo(90),
    to: endOfToday(),
  },
];
