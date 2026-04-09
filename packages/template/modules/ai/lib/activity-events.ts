/**
 * Compute the inbox tab an interaction belongs to, given its current state.
 * - "attention": human/supervised/held modes, or has a pending escalation, or status is 'failed'
 * - "ai": mode is 'ai' and status is 'active'
 * - "done": status is 'resolved'
 */
export function computeTab(
  mode: string | null,
  status: string,
  hasPendingEscalation: boolean,
): 'attention' | 'ai' | 'done' {
  if (status === 'resolved') return 'done';
  if (status === 'failed') return 'attention';
  if (hasPendingEscalation) return 'attention';
  if (mode === 'human' || mode === 'supervised' || mode === 'held')
    return 'attention';
  return 'ai';
}
