/**
 * Free-text reply parser for WhatsApp staff replies (US-009 / Slice B.4).
 *
 * Staff reply to a `vobase_tenant_notification` Meta template by sending a
 * plain text message back. Until Slice C (US-011) ships kind-specific
 * templates with structured `Approve` / `Deny` buttons, decisions arrive as
 * prose — we recognise a leading approve/deny verb and treat the remainder
 * as the staff's note. Anything else falls through as `unknown` so the
 * inbound handler can hand the reply to the operator-thread branch.
 *
 * Case-insensitive, emoji-tolerant. The leading-whitespace allowance covers
 * iOS keyboards that auto-prefix a space; the trailing-text capture preserves
 * any explanation the staff member appended.
 */

// `\b` only matches between a word character and a non-word character — emoji
// codepoints are not word characters, so `(✅)\b` fails on `✅ go for it`.
// Two alternations: word verbs require a word boundary; emoji symbols are
// followed by any non-word char (whitespace, punctuation, or end-of-string).
const APPROVE_REGEX = /^\s*(?:(approve|approved|yes|y|ok|okay|confirm)\b|(✅)(?=\s|$|\W))/i
const DENY_REGEX = /^\s*(?:(deny|denied|no|n|reject|rejected|cancel)\b|(❌)(?=\s|$|\W))/i

export interface ParsedReply {
  decision: 'approve' | 'deny' | 'unknown'
  /**
   * Free-text portion of the reply (after the recognised verb), or the entire
   * trimmed body when the decision is `unknown`. `undefined` when the input
   * is empty or whitespace-only.
   */
  note?: string
}

export function parseReplyText(body: string): ParsedReply {
  const approve = body.match(APPROVE_REGEX)
  if (approve) {
    const note = body.slice(approve[0].length).trim()
    return { decision: 'approve', ...(note ? { note } : {}) }
  }
  const deny = body.match(DENY_REGEX)
  if (deny) {
    const note = body.slice(deny[0].length).trim()
    return { decision: 'deny', ...(note ? { note } : {}) }
  }
  const trimmed = body.trim()
  return { decision: 'unknown', ...(trimmed ? { note: trimmed } : {}) }
}
