/**
 * Pure, synchronous autocomplete engine — no React, no network, no domain data.
 * All matching runs in O(N) over the in-memory corpus, completing in < 1ms.
 */

export type Corpus = string[];

export interface Completions {
  /** The trailing characters to display as ghost text after the cursor. */
  ghost: string | null;
  /** The full corpus string to use when the user accepts the ghost completion. */
  ghostFull: string | null;
  /** Up to `limit` dropdown candidates (ghostFull already excluded from this list). */
  suggestions: string[];
}

/**
 * Build the merged, deduplicated corpus from domain-specific seed phrases,
 * category names, and any extras fetched from the API.
 * Call once at initialisation; refresh when extras change.
 */
export function buildCorpus(seed: string[], categories: string[], extras: string[] = []): Corpus {
  const raw = [
    ...seed,
    ...categories,
    ...extras.map((s) => s.trim()).filter((s) => s.length > 2),
  ];
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const s of raw) {
    const key = s.toLowerCase();
    if (!seen.has(key)) { seen.add(key); deduped.push(s); }
  }
  return deduped;
}

/** Return ghost text and dropdown suggestions for the current input value. */
export function getCompletions(corpus: Corpus, input: string, limit = 5): Completions {
  const q = input.toLowerCase().trim();
  if (q.length === 0) return { ghost: null, ghostFull: null, suggestions: [] };

  const prefix: string[] = [];
  const sub: string[] = [];
  const seenLower = new Set<string>();

  for (const s of corpus) {
    const sl = s.toLowerCase();
    if (sl === q || seenLower.has(sl)) continue;

    if (sl.startsWith(q)) {
      seenLower.add(sl);
      prefix.push(s);
    } else if (q.length >= 3 && sl.includes(q)) {
      seenLower.add(sl);
      sub.push(s);
    }
  }

  const ghostFull = prefix[0] ?? null;
  const ghost = ghostFull ? ghostFull.slice(q.length) : null;
  const suggestions = [...prefix, ...sub].slice(0, limit);

  return { ghost, ghostFull, suggestions };
}
