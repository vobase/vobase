/**
 * Magic-link captor + `mintMagicLink` — post-commit token issuance.
 *
 * better-auth's `sendMagicLink` callback fires synchronously during `signInMagicLink` but
 * returns no value. The captor pattern (see `auth/captor-pattern.ts`) registers a per-call
 * nonce before the call and resolves once `deliver` is invoked from the plugin callback.
 *
 * The `url` arg in `sendMagicLink` is the tenant's own verify endpoint — discarded. We
 * construct the platform deep-link from scratch: the tenant builds the full
 * `/auth/magic-finish` destination URL on its own host, HMAC-signs it with the
 * shared `PLATFORM_HMAC_SECRET`, and wraps it in the platform's trusted-redirect
 * endpoint (`/api/redirect?tenant=&dest=&sig=`). The platform verifies the
 * signature against the tenant's stored secret and 302s to `dest` — no
 * platform-side endpoint registry, no per-org endpoint id.
 */

import { notFound, signHmac } from '@vobase/core'
import { eq } from 'drizzle-orm'

import { readAppBaseUrl } from '~/runtime/app-url'
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

/** Platform trusted-redirect endpoint — verifies the tenant HMAC and 302s to `dest`. */
const PLATFORM_REDIRECT_BASE = 'https://platform.vobase.dev/api/redirect'

/** Per-mint payload threaded through better-auth's `sendMagicLink` metadata. */
interface MintPayload {
  email: string
  redirectPath: string
  organizationId: string
  /** The Auth instance is per-call because this module is stateless w.r.t. it. */
  auth: Auth
}

interface DeliveredToken {
  token: string
  url: string
}

/** Exported so `auth/plugins.ts::sendMagicLink` can call `deliver`. */
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
          organizationId: payload.organizationId,
          // callbackURL is not included in the sendMagicLink callback payload,
          // so we round-trip it here so the captor can construct the platform URL.
          callbackURL: payload.redirectPath,
        },
      },
      headers: new Headers(),
    })
  },
})

/**
 * Invoked by `auth/plugins.ts::sendMagicLink` to resolve the pending captor promise.
 *
 * Builds the tenant-owned `magic-finish` destination, HMAC-signs the full URL with
 * the shared `PLATFORM_HMAC_SECRET`, and wraps it in the platform trusted-redirect
 * endpoint. The platform verifies the signature against the tenant's stored secret
 * and 302s to `dest` verbatim.
 */
export function deliverMagicLinkToken(args: { token: string; metadata: Record<string, unknown> | undefined }): void {
  const { token, metadata } = args
  const organizationId = typeof metadata?.organizationId === 'string' ? metadata.organizationId : ''
  const callbackURL = typeof metadata?.callbackURL === 'string' ? metadata.callbackURL : ''

  const tenantSlug = process.env.VITE_PLATFORM_TENANT_SLUG ?? ''
  const hmacSecret = process.env.PLATFORM_HMAC_SECRET ?? ''
  // Signing with an empty key would mint a syntactically valid URL that always
  // 403s at the platform — fail loudly at mint time instead of at click time.
  if (!tenantSlug || !hmacSecret) {
    throw new MagicLinkMintError('magic_link_mint_failed', {
      cause: new Error('VITE_PLATFORM_TENANT_SLUG and PLATFORM_HMAC_SECRET must be set to sign magic links'),
    })
  }

  const dest = `${readAppBaseUrl()}/auth/magic-finish?token=${encodeURIComponent(token)}&redirect=${encodeURIComponent(callbackURL)}&organization=${encodeURIComponent(organizationId)}`
  const sig = signHmac(dest, hmacSecret)
  const url = `${PLATFORM_REDIRECT_BASE}?tenant=${encodeURIComponent(tenantSlug)}&dest=${encodeURIComponent(dest)}&sig=${sig}`

  magicLinkCaptor.deliver({ metadata, result: { token, url } })
}

// Narrowed to avoid importing ~/runtime (which would create auth ← runtime ← auth cycle).
interface DbForUserLookup {
  // biome-ignore lint/suspicious/noExplicitAny: drizzle select returns unknown table shape
  select: () => any
}

export interface MintInput {
  userId: string
  email: string
  organizationId: string
  /** Produced by `redirectPathFor(refs)` in notification-template-payloads.ts */
  redirectPath: string
}

export interface MintResult {
  url: string
  token: string
  /** ISO 8601 — 24 h from issuance */
  expiresAt: string
}

/**
 * Issue a magic-link token for an existing staff user and return the platform deep-link URL.
 *
 * Throws `MagicLinkMintError` when the user doesn't exist or the captor times out.
 * Must only be called post-commit — never inside a wake-trigger renderer.
 */
export async function mintMagicLink(auth: Auth, db: DbForUserLookup, input: MintInput): Promise<MintResult> {
  const { userId, email, organizationId, redirectPath } = input

  // Pre-flight: fail fast if the user doesn't exist rather than letting
  // better-auth redirect with "new_user_signup_disabled" at verify time.
  let rows: unknown[]
  try {
    rows = await db.select().from(authUser).where(eq(authUser.id, userId)).limit(1)
  } catch (err) {
    throw new MagicLinkMintError('magic_link_mint_failed', { cause: err })
  }
  if (!(rows as Array<unknown>)[0]) {
    throw new MagicLinkMintError('magic_link_mint_failed', { cause: notFound('staff_user_not_found') })
  }

  let captured: DeliveredToken
  try {
    captured = await magicLinkCaptor.mint({ email, redirectPath, organizationId, auth })
  } catch (err) {
    if (err instanceof MagicLinkMintError) {
      throw new MagicLinkMintError('magic_link_mint_failed', { cause: err.cause ?? err })
    }
    throw new MagicLinkMintError('magic_link_mint_failed', { cause: err })
  }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  return { url: captured.url, token: captured.token, expiresAt }
}
