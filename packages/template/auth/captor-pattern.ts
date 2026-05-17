/**
 * Generic captor pattern — shared by `magic-link.ts` and `phone-otp.ts`.
 *
 * ## Why a captor at all?
 *
 * better-auth plugins (`magicLink`, `phoneNumber`) invoke a `sendXxx(...)`
 * callback synchronously inside their respective sign-in endpoints. The callback
 * is the only place where the freshly-minted token / code is exposed; the
 * endpoint's return value is `{ status: true }`. To bridge the gap we register
 * a per-call nonce in a `pending` Map BEFORE invoking the better-auth endpoint,
 * then the plugin's `send` callback calls `captor.deliver({ metadata, result })`
 * which resolves our promise.
 *
 * ## 5 s timeout discipline
 *
 * The `send` callback runs synchronously inside the better-auth endpoint. If a
 * future config change skips it, the pending Promise would leak forever. The
 * `timeoutMs` guard (default 5 000 ms) rejects with `captor_timeout` so callers
 * can wrap the failure in their domain `*MintError` and surface it to the
 * dispatcher.
 *
 * ## Type contract
 *
 * - `TPayload` — the per-call metadata the caller hands to the sender (e.g.
 *   `{ tenantId, organizationId, callbackURL }` for magic-link, or
 *   `{ phoneNumber, tenantId }` for phone-OTP).
 * - `TResult`  — the value the deliver-side hands back (e.g.
 *   `{ url, token }` for magic-link, `{ code }` for phone-OTP).
 *
 * The captor pattern is intentionally agnostic about better-auth — it only
 * orchestrates the pending Map, nonce generation, timeout, and resolution.
 */

import { randomBytes } from 'node:crypto'
import { logger } from '@vobase/core'

/**
 * Per-call pending entry: resolve/reject pair plus the safety-net timeout.
 * Key = 16-byte URL-safe-base64 nonce — collision-free per `mint` call.
 */
interface CaptorEntry<TResult> {
  resolve: (result: TResult) => void
  reject: (e: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
}

/** Generic captor mint error — extended by callers that want a domain-named subclass. */
export class CaptorMintError extends Error {
  override name = 'CaptorMintError'
  cause: unknown
  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    this.cause = options?.cause
  }
}

/** Constructor shape for the optional `errorClass` parameter. */
export type CaptorErrorClass = new (message: string, options?: { cause?: unknown }) => Error

/** Default 5 s — matches §8a.11.1 captor timeout discipline. */
const DEFAULT_TIMEOUT_MS = 5_000

/** Generate a 16-byte URL-safe-base64 nonce (22 chars). */
function generateNonce(): string {
  return randomBytes(16).toString('base64url')
}

export interface CaptorOptions<TPayload> {
  /** Captor name — used in log messages + default error class name. */
  name: string
  /** Optional override; defaults to 5 000 ms. */
  timeoutMs?: number
  /**
   * Caller-supplied sender. Receives the caller's payload and the captor's
   * nonce; must arrange for `deliver({ metadata: { nonce }, result })` to be
   * invoked (typically by passing `nonce` through to a better-auth plugin's
   * `metadata` field so the `sendXxx` callback can read it back).
   */
  sender: (payload: TPayload, nonce: string) => Promise<void>
  /**
   * Optional domain-named error class. Callers that need
   * `instanceof MagicLinkMintError` checks at the dispatcher pass their
   * concrete class here. Defaults to {@link CaptorMintError}.
   */
  errorClass?: CaptorErrorClass
}

export interface Captor<TPayload, TResult> {
  /**
   * Generate a nonce, register a pending entry, invoke `sender(payload, nonce)`,
   * await resolution within `timeoutMs`, and return the delivered `TResult`.
   *
   * Throws `<errorClass>('captor_timeout' | sender error)` — caller wraps the
   * Promise rejection inside its own `*MintError` shape.
   */
  mint(payload: TPayload): Promise<TResult>
  /**
   * Resolve the pending entry whose `metadata.nonce` matches. Unknown nonce
   * throws `<errorClass>('captor_unknown_nonce')` so caller-side bugs surface
   * loudly. Post-timeout deliver is a silent no-op (the timeout already
   * rejected the awaiter and cleared the entry).
   */
  deliver(args: { metadata: { nonce: string } | Record<string, unknown> | undefined; result: TResult }): void
}

/**
 * Build a generic captor with the supplied sender + timeout policy.
 *
 * @example
 *   const captor = createCaptor<MintInput, { url: string; token: string }>({
 *     name: 'magic-link',
 *     timeoutMs: 5_000,
 *     errorClass: MagicLinkMintError,
 *     sender: async (input, nonce) => {
 *       await auth.api.signInMagicLink({
 *         body: { email: input.email, callbackURL: input.redirectPath, metadata: { nonce, ...input } },
 *         headers: new Headers(),
 *       })
 *     },
 *   })
 *
 *   // Producer side
 *   const { url, token } = await captor.mint(input)
 *
 *   // Consumer side (inside better-auth plugin's sendMagicLink callback)
 *   captor.deliver({ metadata: { nonce: metadata.nonce }, result: { url, token } })
 */
/**
 * Retain timed-out nonces for this many ms so a late `deliver` is recognized
 * as "post-timeout no-op" rather than "unknown nonce". 60 s comfortably covers
 * any plugin that calls the send callback minutes after our timeout fired (in
 * practice it always fires synchronously, but the broader window costs nothing
 * and prevents spurious `captor_unknown_nonce` throws).
 */
const TIMED_OUT_RETENTION_MS = 60_000

export function createCaptor<TPayload, TResult>(opts: CaptorOptions<TPayload>): Captor<TPayload, TResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const ErrorCtor: CaptorErrorClass = opts.errorClass ?? CaptorMintError
  const pending = new Map<string, CaptorEntry<TResult>>()
  // `timedOut` records nonces whose pending entry was evicted by the timeout
  // path. A deliver landing on one of these is a silent no-op (the awaiter
  // already received `captor_timeout`). Entries self-clean after
  // `TIMED_OUT_RETENTION_MS` so the set cannot grow without bound.
  const timedOut = new Set<string>()

  return {
    async mint(payload: TPayload): Promise<TResult> {
      const nonce = generateNonce()

      const captorPromise = new Promise<TResult>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          pending.delete(nonce)
          timedOut.add(nonce)
          setTimeout(() => {
            timedOut.delete(nonce)
          }, TIMED_OUT_RETENTION_MS).unref?.()
          reject(new ErrorCtor('captor_timeout'))
        }, timeoutMs)
        // Avoid keeping the event loop alive solely for this timer (tests +
        // long-running servers both benefit; the timeout still fires while the
        // process is doing other work).
        timeoutId.unref?.()
        pending.set(nonce, { resolve, reject, timeoutId })
      })

      try {
        await opts.sender(payload, nonce)
      } catch (err) {
        // Clean up pending entry so the timeout doesn't fire spuriously on a
        // sender that threw synchronously / rejected its promise.
        const entry = pending.get(nonce)
        if (entry) {
          clearTimeout(entry.timeoutId)
          pending.delete(nonce)
        }
        // Re-throw via the caller's error class so the dispatcher's
        // `instanceof <Name>MintError` catch matches uniformly.
        throw new ErrorCtor('captor_send_failed', { cause: err })
      }

      return captorPromise
    },

    deliver({ metadata, result }): void {
      const rawNonce = metadata && typeof metadata === 'object' ? (metadata as { nonce?: unknown }).nonce : undefined
      if (typeof rawNonce !== 'string') {
        logger.warn(
          { captor: opts.name, metadata },
          `[auth:${opts.name}-captor] deliver invoked with no nonce — ignoring (captor leak detection)`,
        )
        return
      }
      const entry = pending.get(rawNonce)
      if (entry) {
        clearTimeout(entry.timeoutId)
        pending.delete(rawNonce)
        entry.resolve(result)
        return
      }
      if (timedOut.has(rawNonce)) {
        // Post-timeout deliver — the awaiter was already rejected with
        // `captor_timeout`; nothing to do here.
        logger.warn(
          { captor: opts.name, nonce: rawNonce },
          `[auth:${opts.name}-captor] post-timeout deliver — silent no-op (awaiter already rejected with captor_timeout)`,
        )
        return
      }
      // Unknown nonce — deliver was invoked WITHOUT a prior mint. Loud throw
      // so caller-side bugs surface immediately.
      throw new ErrorCtor('captor_unknown_nonce')
    },
  }
}
