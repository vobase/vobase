/**
 * Compute the inbox tab a conversation belongs to, given its current state.
 * - "attention": human/supervised/held modes, or has a pending escalation, or status is 'failed'
 * - "ai": mode is 'ai' and status is 'active'
 * - "done": status is 'completed' or 'resolved'
 */
export function computeTab(
  mode: string | null,
  status: string,
  hasPendingEscalation: boolean,
): 'attention' | 'ai' | 'done' {
  if (status === 'completed') return 'done';
  if (status === 'failed') return 'attention';
  if (hasPendingEscalation) return 'attention';
  if (mode === 'human' || mode === 'supervised' || mode === 'held')
    return 'attention';
  return 'ai';
}
