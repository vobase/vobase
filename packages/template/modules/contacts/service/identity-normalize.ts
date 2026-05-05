/**
 * Light-touch identity normalizers for inbound contact resolution.
 *
 * Bare E.164 with leading `+` is the canonical phone form across the template;
 * agent prompts, outbound `to:` addresses, and the contacts UI all expect this
 * shape. Inbound channels supply varied formats (Meta sends bare digits without
 * `+`; Twilio sends a `whatsapp:+E.164` URL scheme; SMS gateways vary), so we
 * canonicalize once at the boundary.
 *
 * No `libphonenumber-js` dep — region-aware validation is over-kill for a
 * scaffold and forks that need it can swap in trivially. We only do the bits
 * that actually matter for cross-channel dedup: strip non-digits, prepend `+`,
 * length-bound to 7–15 digits per E.164.
 */

const E164_DIGITS_RE = /\d/g

/**
 * Strip non-digits, prepend `+`. Returns `null` if the resulting digit count
 * falls outside E.164's 7–15 digit range — we'd rather drop the value than
 * persist a malformed phone that breaks outbound delivery later.
 */
export function normalizePhoneE164(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = (raw.match(E164_DIGITS_RE) ?? []).join('')
  if (digits.length < 7 || digits.length > 15) return null
  return `+${digits}`
}

/** Trim + lowercase. Returns `null` if there's no `@` (invalid email). */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed.includes('@')) return null
  return trimmed
}
