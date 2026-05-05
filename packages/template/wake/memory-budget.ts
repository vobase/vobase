/**
 * Per-wake memory-budget header rendered as a single HTML comment line at the
 * top of each `MEMORY.md` materializer output. The header is purely
 * informational for the agent — visibility hint, not enforcement.
 *
 * Determinism: this file MUST stay byte-pure across same-input calls and
 * across hosts. Any wall-clock, RNG, env, or per-host identifier will divide
 * `systemHash` and blow up the prefix-cache. The structural source-regex
 * guard in `wake/memory-budget.test.ts` enumerates the banned identifier set
 * and fails the build if any of them appear here.
 */

export type MemoryScope = 'agent' | 'contact' | 'staff'

/**
 * Default soft cap for body characters surfaced in the budget header. Imported
 * by all three call-sites (agents/contacts/team materializers) so there is no
 * magic number drifting between scopes.
 */
export const DEFAULT_MEMORY_SOFT_CAP_CHARS = 8000

/**
 * Renders a single-scope budget header line. The chars/cap fields are UTF-16
 * code-unit counts (JS .length) — the literal "(utf16)" token in the rendered
 * output self-discloses this so downstream consumers know not to treat the
 * value as a wire-byte budget. Over-cap by ~3x for multi-byte CJK is
 * acceptable; the cap is a soft visibility hint.
 */
export function renderMemoryWithBudget(opts: {
  scope: MemoryScope
  id: string
  body: string
  softCapChars: number
}): string {
  const chars = opts.body.length
  const over = chars > opts.softCapChars
  return `<!-- memory-budget scope=${opts.scope} id=${opts.id} chars=${chars} (utf16) cap=${opts.softCapChars} over=${over.toString()} -->\n`
}

/**
 * Strip a leading `<!-- memory-budget ... -->\n` line from a memory body so
 * a re-render does not stack a second header on top of the first.
 *
 * The workspace-sync observer flushes the rendered file body (header + memory
 * prose) back to the backing column on `agent_end`; without this strip, the
 * NEXT wake's materializer would read the stored body — which already starts
 * with a header — and prepend another one. Idempotent: returns the input
 * unchanged when the body has no leading header.
 *
 * Anchored on the literal `<!-- memory-budget ` prefix; deliberately does
 * NOT match other HTML comments so unrelated leading comments survive.
 */
export function stripBudgetHeader(body: string): string {
  if (!body.startsWith('<!-- memory-budget ')) return body
  const newlineIdx = body.indexOf('\n')
  if (newlineIdx < 0) return body
  return body.slice(newlineIdx + 1)
}
