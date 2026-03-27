/**
 * Knowledge Base backend search configuration.
 * Intent signals for hybrid search.
 */

/**
 * Extract intent signals from a raw query string.
 * Returns the cleaned query with intent fragments removed.
 */
export function extractIntent(raw: string): {
  cleanQuery: string;
  sortHint?: string;
} {
  let q = raw.toLowerCase().trim();
  let sortHint: string | undefined;

  // Detect recency signals
  if (/\b(recent|latest|newest|new)\b/.test(q)) {
    sortHint = 'recent';
    q = q.replace(/\b(recent|latest|newest|new)\b/g, '').trim();
  }

  // Detect oldest signals
  if (/\b(oldest|earliest|first)\b/.test(q)) {
    sortHint = 'oldest';
    q = q.replace(/\b(oldest|earliest|first)\b/g, '').trim();
  }

  // Clean up extra whitespace
  q = q.replace(/\s+/g, ' ').trim();

  return { cleanQuery: q || raw.trim(), sortHint };
}
