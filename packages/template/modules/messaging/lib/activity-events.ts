export type InboxTab = 'active' | 'on-hold' | 'done';

export const INBOX_TABS: readonly InboxTab[] = [
  'active',
  'on-hold',
  'done',
] as const;

/**
 * Compute the inbox tab a conversation belongs to, given its current state.
 * - "active": status is 'active' and not on hold
 * - "on-hold": status is 'active' and on hold
 * - "done": status is 'resolved' or 'failed'
 */
export function computeTab(status: string, onHold: boolean): InboxTab {
  if (status === 'resolved' || status === 'failed') return 'done';
  if (onHold) return 'on-hold';
  return 'active';
}
