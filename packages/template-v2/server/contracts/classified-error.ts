/**
 * Discriminated union of classifier-assigned error reasons.
 *
 * Trimmed to 4 reasons: Bifrost owns auth/billing/rate_limit/model_not_found/
 * overloaded/thinking_signature/long_context_tier in production; dev mode
 * fail-fast is acceptable for the rest.
 */

export type ClassifiedErrorReason = 'context_overflow' | 'payload_too_large' | 'transient' | 'unknown'

type ClassifiedErrorBase = {
  httpStatus?: number
  providerMessage: string
  retryAfterMs?: number
}

export type ClassifiedError =
  | ({ reason: 'context_overflow' } & ClassifiedErrorBase)
  | ({ reason: 'payload_too_large' } & ClassifiedErrorBase)
  | ({ reason: 'transient' } & ClassifiedErrorBase)
  | ({ reason: 'unknown' } & ClassifiedErrorBase)
