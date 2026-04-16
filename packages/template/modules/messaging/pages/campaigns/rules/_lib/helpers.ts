export type StatusVariant =
  | 'default'
  | 'success'
  | 'warning'
  | 'error'
  | 'info';

export function ruleStatusVariant(isActive: boolean): StatusVariant {
  return isActive ? 'success' : 'default';
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

export function cronToHuman(cron: string | null | undefined): string {
  if (!cron) return '—';
  if (cron === '* * * * *') return 'Every minute';
  if (cron === '0 * * * *') return 'Every hour';
  if (cron === '0 0 * * *') return 'Daily';
  if (cron === '0 0 * * 1') return 'Every Monday';
  if (cron === '0 9 * * *') return 'Daily at 9 AM';
  return cron;
}
