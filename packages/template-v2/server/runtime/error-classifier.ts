/**
 * Pure error classifier — maps raw provider errors to `ClassifiedError`.
 *
 * Classification is purely structural: httpStatus + error code + message patterns.
 * No side effects. `'unknown'` is never silently coerced to `'transient'` — novel
 * errors surface as unknown so they can be captured for drift detection.
 */

import type { ClassifiedError } from '@server/contracts/classified-error'

const CONTEXT_CODES = new Set(['context_length_exceeded', 'context_window_exceeded', 'input_too_large'])

const CONTEXT_PATTERNS = [
  'maximum context length',
  'context_length_exceeded',
  'context window',
  'prompt is too long',
  'too many tokens',
  "model's maximum context",
  'exceeds the model maximum',
]

const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504])

const NETWORK_PATTERNS = ['fetch failed', 'econnreset', 'etimedout', 'econnrefused', 'socket hang up', 'network error']

function extractHttpStatus(err: unknown): number | undefined {
  if (err == null || typeof err !== 'object') return undefined
  const status = (err as Record<string, unknown>).status
  return typeof status === 'number' ? status : undefined
}

function extractCode(err: unknown): string | undefined {
  if (err == null || typeof err !== 'object') return undefined
  const code = (err as Record<string, unknown>).code
  return typeof code === 'string' ? code : undefined
}

function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err != null && typeof err === 'object') {
    const msg = (err as Record<string, unknown>).message
    if (typeof msg === 'string') return msg
  }
  return String(err)
}

function extractRetryAfterMs(err: unknown): number | undefined {
  if (err == null || typeof err !== 'object') return undefined
  const headers = (err as Record<string, unknown>).headers
  if (headers == null || typeof headers !== 'object') return undefined
  const retryAfter = (headers as Record<string, unknown>)['retry-after']
  if (typeof retryAfter !== 'string') return undefined
  const secs = Number.parseFloat(retryAfter)
  return Number.isFinite(secs) ? Math.round(secs * 1000) : undefined
}

function isContextOverflow(message: string, code: string | undefined): boolean {
  if (code !== undefined && CONTEXT_CODES.has(code)) return true
  const lower = message.toLowerCase()
  return CONTEXT_PATTERNS.some((p) => lower.includes(p.toLowerCase()))
}

function isNetworkError(err: unknown, message: string): boolean {
  if (err instanceof Error && (err.name === 'FetchError' || err.name === 'APIConnectionError')) return true
  const lower = message.toLowerCase()
  return NETWORK_PATTERNS.some((p) => lower.includes(p))
}

function isTimeoutError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.name === 'AbortError' || err.name === 'TimeoutError' || err.name === 'APIConnectionTimeoutError'
  }
  return false
}

/**
 * Classify a thrown provider error into a structured `ClassifiedError`.
 *
 * Resolution order:
 * 1. HTTP 413 → `payload_too_large`
 * 2. Message/code signals context overflow → `context_overflow`
 * 3. Transient HTTP status (408/429/5xx) → `transient`
 * 4. AbortError / timeout → `transient`
 * 5. Network error patterns → `transient`
 * 6. Anything else → `unknown` (never silently coerced to `transient`)
 */
export function classifyError(error: unknown): ClassifiedError {
  const httpStatus = extractHttpStatus(error)
  const code = extractCode(error)
  const providerMessage = extractMessage(error)
  const retryAfterMs = extractRetryAfterMs(error)

  if (httpStatus === 413) {
    return { reason: 'payload_too_large', httpStatus, providerMessage }
  }

  if (isContextOverflow(providerMessage, code)) {
    return { reason: 'context_overflow', httpStatus, providerMessage }
  }

  if (httpStatus !== undefined && TRANSIENT_STATUSES.has(httpStatus)) {
    return { reason: 'transient', httpStatus, providerMessage, retryAfterMs }
  }

  if (isTimeoutError(error)) {
    return { reason: 'transient', providerMessage }
  }

  if (isNetworkError(error, providerMessage)) {
    return { reason: 'transient', providerMessage }
  }

  return { reason: 'unknown', httpStatus, providerMessage }
}
