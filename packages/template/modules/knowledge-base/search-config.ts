/**
 * Knowledge Base backend search configuration.
 * Stopwords, field weights, and intent signals for hybrid search.
 */

/** High-frequency terms that add no search signal. */
export const STOPWORDS = new Set([
  // General English
  'a', 'an', 'the', 'of', 'in', 'for', 'to', 'and', 'or', 'is', 'it',
  'with', 'that', 'this', 'on', 'at', 'by', 'from', 'be', 'as', 'are',
  'was', 'were', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
  'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can',
  'not', 'no', 'but', 'if', 'so', 'what', 'how', 'when', 'where', 'who',
  // KB-specific: appear in most documents
  'document', 'page', 'section', 'file', 'content',
]);

/**
 * Per-field lexical scoring weights.
 * Higher weight = more influence on keyword match score.
 */
export const FIELD_WEIGHTS: Record<string, number> = {
  title: 3.0,
  content: 1.0,
};

/**
 * Extract intent signals from a raw query string.
 * Returns the cleaned query with intent fragments removed.
 */
export function extractIntent(
  raw: string,
): { cleanQuery: string; sortHint?: string } {
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

/**
 * Tokenize a query string, removing short tokens and stopwords.
 * Returns lowercase tokens only.
 */
export function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter((k) => k.length > 1 && !STOPWORDS.has(k));
}
