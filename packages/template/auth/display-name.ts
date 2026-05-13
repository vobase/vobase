/**
 * Email → display-name inference. Used as a fallback when better-auth has not
 * captured a `name` on the user (most common with email-OTP sign-in, where the
 * provider hands us only the address). Splits the local-part on common
 * separators and title-cases each token: `carl.luo@x.com` → `Carl Luo`,
 * `j_smith@x.com` → `J Smith`.
 */
export function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? ''
  const cleaned = local.replace(/\+.*$/, '')
  const parts = cleaned
    .split(/[._\-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
  return parts.join(' ') || local || email
}
