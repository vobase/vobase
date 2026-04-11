/**
 * Compute the inbox tab a conversation belongs to, given its current state.
 * - "active": status is 'active' and not on hold
 * - "on-hold": status is 'active' and on hold
 * - "done": status is 'resolved' or 'failed'
 */
export function computeTab(
  status: string,
  onHold: boolean,
): 'active' | 'on-hold' | 'done' {
  if (status === 'resolved' || status === 'failed') return 'done';
  if (onHold) return 'on-hold';
  return 'active';
}
