/**
 * Magic-link captor + `mintMagicLink` — post-commit token issuance (Principle 6).
 *
 * ## Captor pattern
 *
 * better-auth's `magicLink` plugin calls `sendMagicLink({ email, url, token, metadata }, ctx)`
 * synchronously inside the `POST /sign-in/magic-link` handler. We cannot get the generated
 * token back via a return value — `signInMagicLink` returns `{ status: true }`. Instead we
 * register a per-call nonce via the shared {@link createCaptor} helper BEFORE calling
 * `auth.api.signInMagicLink`, and the plugin calls `magicLinkCaptor.deliver(...)` which
 * resolves our promise.
 *
 * The captor mechanics (pending Map, nonce generation, 5 s timeout, error wrapping) live in
 * `auth/captor-pattern.ts`. This file owns the magic-link-specific URL construction +
 * pre-flight user existence check.
 *
 * ## Why the URL is constructed, not stripped
 *
 * better-auth's `sendMagicLink` callback receives `url` =
 *   `${tenantBaseURL}${basePath}/magic-link/verify?token=…&callbackURL=…`
 *   That is the TENANT's own verify endpoint — it can't be used as a platform
 *   notification link. We DISCARD it entirely.
 *
 * `callbackURL` is NOT included in the `sendMagicLink` payload, so we round-trip
 *   it through `metadata.callbackURL` so the captor can reconstruct the full
 *   platform deep-link URL:
 *   `https://platform.voltade.app/auth/magic?tenant=<tid>&token=<tok>&redirect=<path>&organization=<oid>`
 */

import { notFound } from '@vobase/core'
import { eq } from 'drizzle-orm'

import { createCaptor } from './captor-pattern'
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

/**
 * Per-mint payload threaded through better-auth into the `sendMagicLink`
 * callback's `metadata` field. Captures everything the captor needs to
 * reconstruct the platform deep-link URL — see Blockers 1+2 above for why the
 * tenant verify URL is discarded.
 */
interface MintPayload {
  email: string
  redirectPath: string
  tenantId: string
  organizationId: string
  /** The Auth instance is per-call because this module is stateless w.r.t. it. */
  auth: Auth
}

interface DeliveredToken {
  token: string
  /** The platform deep-link URL, constructed by `magicLinkCaptor.deliver` from metadata. */
  url: string
}

/**
 * Shared captor instance. Stateful in the pending Map sense — exported so the
 * better-auth `sendMagicLink` callback in `auth/plugins.ts` can call `deliver`.
 */
export const magicLinkCaptor = createCaptor<MintPayload, DeliveredToken>({
  name: 'magic-link',
  timeoutMs: CAPTOR_TIMEOUT_MS,
  errorClass: MagicLinkMintError,
  sender: async (payload, nonce) => {
    await payload.auth.api.signInMagicLink({
      body: {
        email: payload.email,
        callbackURL: payload.redirectPath,
        metadata: {
          nonce,
          tenantId: payload.tenantId,
          organizationId: payload.organizationId,
          // Round-trip callbackURL through metadata because better-auth does not
          // include callbackURL in the sendMagicLink payload.
          callbackURL: payload.redirectPath,
        },
      },
      headers: new Headers(),
    })
  },
})

/**
 * Construct the platform deep-link URL from the captor metadata. Invoked by
 * `auth/plugins.ts::sendMagicLink` callback — it adapts better-auth's
 * `{ token, metadata }` shape into the captor's `{ metadata, result }` contract
 * and never parses the tenant verify URL (Blocker 1).
 */
export function deliverMagicLinkToken(args: { token: string; metadata: Record<string, unknown> | undefined }): void {
  const { token, metadata } = args
  const tenantId = typeof metadata?.tenantId === 'string' ? metadata.tenantId : ''
  const organizationId = typeof metadata?.organizationId === 'string' ? metadata.organizationId : ''
  const callbackURL = typeof metadata?.callbackURL === 'string' ? metadata.callbackURL : ''

  // Construct the platform URL from scratch — never parse the tenant verify URL.
  const url = `${PLATFORM_MAGIC_BASE}?tenant=${encodeURIComponent(tenantId)}&token=${encodeURIComponent(token)}&redirect=${encodeURIComponent(callbackURL)}&organization=${encodeURIComponent(organizationId)}`

  magicLinkCaptor.deliver({ metadata, result: { token, url } })
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
 * - This function MUST only be called post-commit (Principle 6).
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

  // Captor mints the token; the shared helper owns the pending Map, nonce
  // generation, 5 s timeout, and `MagicLinkMintError`-wrapped failure shape.
  let captured: DeliveredToken
  try {
    captured = await magicLinkCaptor.mint({ email, redirectPath, tenantId, organizationId, auth })
  } catch (err) {
    // The captor already wraps in MagicLinkMintError (via `errorClass` option),
    // but re-wrap with the canonical `magic_link_mint_failed` message so the
    // dispatcher's error-message check is unchanged.
    if (err instanceof MagicLinkMintError) {
      throw new MagicLinkMintError('magic_link_mint_failed', { cause: err.cause ?? err })
    }
    throw new MagicLinkMintError('magic_link_mint_failed', { cause: err })
  }

  // Date.now() is acceptable here: this is POST-COMMIT (Principle 6), NOT inside
  // a wake-trigger renderer (Principle 3 — deterministic frozen-snapshot zone).
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  return { url: captured.url, token: captured.token, expiresAt }
}
