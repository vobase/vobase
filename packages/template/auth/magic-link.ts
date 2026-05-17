/**
 * Magic-link captor + `mintMagicLink` — post-commit token issuance (Principle 6).
 *
 * ## Captor pattern
 *
 * better-auth's `magicLink` plugin calls `sendMagicLink({ email, url, token, metadata }, ctx)`
 * synchronously inside the `POST /sign-in/magic-link` handler. We cannot get the generated
 * token back via a return value — `signInMagicLink` returns `{ status: true }`. Instead we
 * register a per-call nonce in the `pending` Map BEFORE calling `auth.api.signInMagicLink`,
 * and the plugin calls `magicLinkCaptor.deliver(...)` which resolves our promise.
 *
 * ## 5 s timeout discipline
 *
 * `sendMagicLink` is called synchronously within the better-auth endpoint handler.
 * If it is somehow never called (e.g. a future plugin config change), the pending
 * Promise would leak forever. The 5 s timeout in `mintMagicLink` guards against this.
 *
 * ## Why the URL is constructed, not stripped (plan §8a.3 Blockers 1+2, iteration-3)
 *
 * Blocker 1: better-auth's `sendMagicLink` callback receives `url` =
 *   `${tenantBaseURL}${basePath}/magic-link/verify?token=…&callbackURL=…`
 *   That is the TENANT's own verify endpoint — it can't be used as a platform
 *   notification link. We DISCARD it entirely.
 *
 * Blocker 2: `callbackURL` is NOT included in the `sendMagicLink` payload. We
 *   round-trip it through `metadata.callbackURL` so the captor can reconstruct the
 *   full platform deep-link URL:
 *   `https://platform.voltade.app/auth/magic?tenant=<tid>&token=<tok>&redirect=<path>&organization=<oid>`
 */

import { logger, notFound } from '@vobase/core'
import { eq } from 'drizzle-orm'

import type { Auth } from './index'
import { authUser } from './schema'

/**
 * Thrown by `mintMagicLink` when the mint operation fails (captor timeout,
 * better-auth error, user not found, etc.). The dispatcher catches this by
 * `instanceof` check and writes `automation_runs(status='failed',
 * errorMessage='magic_link_mint_failed')` without calling `sendTemplate`.
 */
export class MagicLinkMintError extends Error {
  override name = 'MagicLinkMintError'
  cause: unknown
  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    this.cause = options?.cause
  }
}

const CAPTOR_TIMEOUT_MS = 5_000

const PLATFORM_MAGIC_BASE = 'https://platform.voltade.app/auth/magic'

// Per-call entry: holds the resolve/reject pair + a safety-net timeout.
// Key = 16-byte URL-safe-base64 nonce — collision-free per mintMagicLink call.
interface CaptorEntry {
  resolve: (result: { url: string; token: string }) => void
  reject: (e: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
}

const pending = new Map<string, CaptorEntry>()

/**
 * Receives the token from better-auth's sendMagicLink callback.
 * Constructs the platform deep-link URL from metadata fields (not from the
 * tenant verify-URL passed as `url` — that is discarded per plan §8a.3 Blocker 1).
 */
export const magicLinkCaptor = {
  deliver({ token, metadata }: { token: string; metadata: Record<string, unknown> | undefined }): void {
    const nonce = metadata?.nonce
    if (typeof nonce !== 'string') {
      logger.warn(
        { metadata },
        '[auth:magic-link-captor] sendMagicLink invoked with no nonce — ignoring (captor leak detection)',
      )
      return
    }
    const entry = pending.get(nonce)
    if (!entry) {
      logger.warn({ nonce }, '[auth:magic-link-captor] No pending entry for nonce — possible timeout already fired')
      return
    }
    const tenantId = typeof metadata?.tenantId === 'string' ? metadata.tenantId : ''
    const organizationId = typeof metadata?.organizationId === 'string' ? metadata.organizationId : ''
    const callbackURL = typeof metadata?.callbackURL === 'string' ? metadata.callbackURL : ''

    // Construct the platform URL from scratch — never parse the tenant verify URL.
    const url = `${PLATFORM_MAGIC_BASE}?tenant=${encodeURIComponent(tenantId)}&token=${encodeURIComponent(token)}&redirect=${encodeURIComponent(callbackURL)}&organization=${encodeURIComponent(organizationId)}`

    clearTimeout(entry.timeoutId)
    pending.delete(nonce)
    entry.resolve({ url, token })
  },
}

// Minimal Drizzle-compatible db shape for the user existence check.
// Callers pass ScopedDb; the type is narrowed here to avoid importing
// ~/runtime (which would create a circular dependency: auth ← runtime ← auth).
interface DbForUserLookup {
  // biome-ignore lint/suspicious/noExplicitAny: drizzle select returns unknown table shape
  select: () => any
}

export interface MintInput {
  userId: string
  email: string
  tenantId: string
  organizationId: string
  /** Produced by `redirectPathFor(refs)` in notification-template-payloads.ts */
  redirectPath: string
}

export interface MintResult {
  /** https://platform.voltade.app/auth/magic?tenant=<tid>&token=<tok>&redirect=<percent-encoded-path>&organization=<oid> */
  url: string
  token: string
  /** ISO 8601 — 24 h from issuance (matches `expiresIn: 60 * 60 * 24` in the plugin config) */
  expiresAt: string
}

/**
 * Issue a magic-link token for an existing staff user and return the platform
 * deep-link URL ready to embed in a notification.
 *
 * ## Constraints
 * - TTL is 24 h (matching `expiresIn: 60 * 60 * 24` in the magicLink plugin config).
 * - Single-use: better-auth's `allowedAttempts: 1` default means the token is
 *   invalidated after one successful verify.
 * - Sign-up is disabled (`disableSignUp: true`): if the email has no corresponding
 *   user, this function throws `notFound('staff_user_not_found')`.
 * - Tokens are stored hashed (`storeToken: 'hashed'`) — plain-text tokens never
 *   appear in the database.
 * - This function MUST only be called post-commit (Principle 6 — plan §8a.1).
 *   Never call from inside a wake-trigger renderer or WorkspaceMaterializerFactory
 *   — `check:shape` enforces the import boundary.
 *
 * @param auth - the auth instance (from `createAuth(db)`)
 * @param db - the Drizzle DB instance (needed for user existence pre-flight)
 * @param input - mint parameters
 */
export async function mintMagicLink(auth: Auth, db: DbForUserLookup, input: MintInput): Promise<MintResult> {
  const { userId, email, tenantId, organizationId, redirectPath } = input

  // Pre-flight: verify the user exists so we throw a clean error before touching
  // better-auth's token store. `disableSignUp: true` means the verify step would
  // redirect with "new_user_signup_disabled" if the user doesn't exist — we want
  // to fail fast and loud here instead.
  let rows: unknown[]
  try {
    rows = await db.select().from(authUser).where(eq(authUser.id, userId)).limit(1)
  } catch (err) {
    throw new MagicLinkMintError('magic_link_mint_failed', { cause: err })
  }
  if (!(rows as Array<unknown>)[0]) {
    throw new MagicLinkMintError('magic_link_mint_failed', { cause: notFound('staff_user_not_found') })
  }

  // 16-byte URL-safe-base64 nonce — keyed per-call, collision-free.
  const nonceBytes = new Uint8Array(16)
  crypto.getRandomValues(nonceBytes)
  const nonce = Buffer.from(nonceBytes).toString('base64url')

  // Captor promise: resolves when sendMagicLink callback fires, rejects on timeout.
  const captorPromise = new Promise<{ url: string; token: string }>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pending.delete(nonce)
      reject(new Error('captor_timeout'))
    }, CAPTOR_TIMEOUT_MS)
    pending.set(nonce, { resolve, reject, timeoutId })
  })

  try {
    await auth.api.signInMagicLink({
      body: {
        email,
        callbackURL: redirectPath,
        metadata: {
          nonce,
          tenantId,
          organizationId,
          // Round-trip callbackURL through metadata because better-auth does not
          // include callbackURL in the sendMagicLink payload (plan §8a.3 step 4).
          callbackURL: redirectPath,
        },
      },
      headers: new Headers(),
    })
  } catch (err) {
    // If signInMagicLink throws (e.g. rate-limit), clean up the pending entry so
    // the captor timeout doesn't fire spuriously.
    const entry = pending.get(nonce)
    if (entry) {
      clearTimeout(entry.timeoutId)
      pending.delete(nonce)
    }
    throw new MagicLinkMintError('magic_link_mint_failed', { cause: err })
  }

  // Await the captor — sendMagicLink is called synchronously inside the
  // signInMagicLink handler, so this should resolve almost immediately.
  let captured: { url: string; token: string }
  try {
    captured = await captorPromise
  } catch (err) {
    throw new MagicLinkMintError('magic_link_mint_failed', { cause: err })
  }
  const { url, token } = captured

  // Date.now() is acceptable here: this is POST-COMMIT (Principle 6), NOT inside
  // a wake-trigger renderer (Principle 3 — deterministic frozen-snapshot zone).
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  return { url, token, expiresAt }
}
