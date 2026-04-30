/**
 * Shared `@<Name>` scanner used by the composer (to derive the mention
 * tokens persisted on a note) and the message-thread renderer (to pill the
 * matching substrings in the body). Longest-name precedence + word-boundary
 * guard, so `@Carl` doesn't match when the body says `@Carl Luo` and
 * `@Sentinelbot` doesn't match `@Sentinel`. Case-insensitive.
 */

import type { PrincipalRecord } from '@/components/principal'

export interface MentionMatch {
  start: number
  end: number
  record: PrincipalRecord
}

export function findMentions(body: string, candidates: readonly PrincipalRecord[]): MentionMatch[] {
  if (candidates.length === 0) return []
  const lowered = candidates
    .map((r) => ({ record: r, lc: `@${r.name}`.toLowerCase() }))
    .sort((a, b) => b.lc.length - a.lc.length)
  const lower = body.toLowerCase()
  const out: MentionMatch[] = []
  let i = 0
  while (i < body.length) {
    if (body[i] !== '@') {
      i++
      continue
    }
    let matched: MentionMatch | null = null
    for (const c of lowered) {
      if (!lower.startsWith(c.lc, i)) continue
      const next = body[i + c.lc.length]
      if (next !== undefined && /[A-Za-z0-9._-]/.test(next)) continue
      matched = { start: i, end: i + c.lc.length, record: c.record }
      break
    }
    if (!matched) {
      i++
      continue
    }
    out.push(matched)
    i = matched.end
  }
  return out
}
