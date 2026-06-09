/**
 * phone-verify-engine — framework-free logic for staff WhatsApp OTP verification.
 *
 * Pure functions only (no React, no `authClient`) so they are Bun-testable
 * without a DOM. The React layer (`use-phone-verify.ts`, `PhoneVerifyControls`)
 * is a thin wrapper over these.
 */

export const OTP_LENGTH = 6

/** Minimal view of the signed-in user needed to decide the verification nudge. */
export interface VerifyStateInput {
  phoneNumber?: string | null
  phoneNumberVerified?: boolean | null
}

export interface VerifyState {
  hasNumber: boolean
  isVerified: boolean
  shouldNudge: boolean
}

/**
 * Decide whether to nudge the signed-in user to verify their WhatsApp number.
 * Nudge only when a number is on file but not yet verified — a missing number
 * reads as "opted out of WhatsApp pings", so we stay silent.
 */
export function computeVerifyState(user: VerifyStateInput | null): VerifyState {
  const hasNumber = Boolean(user?.phoneNumber)
  const isVerified = hasNumber && user?.phoneNumberVerified === true
  return { hasNumber, isVerified, shouldNudge: hasNumber && !isVerified }
}

export interface ResolveVerifyArgsInput {
  /** The (possibly edited) number currently in the input. */
  typed: string
  /** The number already saved on the user's account. */
  saved: string
  code: string
}

export interface VerifyArgs {
  phoneNumber: string
  code: string
  updatePhoneNumber: boolean
}

/**
 * Build the arguments for `authClient.phoneNumber.verify`. `updatePhoneNumber`
 * is true only when the typed number differs from the saved one: better-auth
 * then attaches it to the signed-in user's row and marks it verified. Verifying
 * the already-saved number with the flag set self-collides on the unique
 * constraint (`PHONE_NUMBER_EXIST`), so we clear it in that case.
 */
export function resolveVerifyArgs({ typed, saved, code }: ResolveVerifyArgsInput): VerifyArgs {
  const phoneNumber = typed.trim()
  return { phoneNumber, code, updatePhoneNumber: phoneNumber !== saved.trim() }
}

/** Shape of a better-auth client call result, narrowed to the error we read. */
export type AuthClientResult = { error?: { message?: string; code?: string } | null } | null | undefined

export type VerifyErrorKind = 'send' | 'verify'

/** Shown when the org's WhatsApp OTP template isn't approved yet (early setup). */
export const TEMPLATE_UNAPPROVED_MESSAGE =
  "WhatsApp verification isn't set up for your organization yet — ask an admin to connect a WhatsApp channel."

const SEND_FALLBACK = 'Could not send the code. Try again.'
const VERIFY_FALLBACK = 'That code did not work. Try again.'
const TEMPLATE_UNAPPROVED_CODES = new Set(['PHONE_OTP_TEMPLATE_UNAPPROVED', 'phone_otp_template_unapproved'])

export interface NormalizedAuthError {
  /** Human-readable message, or null when the result carried no error. */
  message: string | null
  /** True for the unapproved-template gate — a terminal, non-retryable state. */
  isTemplateUnapproved: boolean
}

/**
 * Turn a better-auth result into a friendly message. The unapproved-template
 * gate gets a distinct, actionable message; everything else passes the server
 * message through, falling back to a kind-specific default.
 */
export function normalizeAuthError(res: AuthClientResult, kind: VerifyErrorKind): NormalizedAuthError {
  const err = res?.error
  if (!err) return { message: null, isTemplateUnapproved: false }
  if (err.code && TEMPLATE_UNAPPROVED_CODES.has(err.code)) {
    return { message: TEMPLATE_UNAPPROVED_MESSAGE, isTemplateUnapproved: true }
  }
  return { message: err.message ?? (kind === 'send' ? SEND_FALLBACK : VERIFY_FALLBACK), isTemplateUnapproved: false }
}
