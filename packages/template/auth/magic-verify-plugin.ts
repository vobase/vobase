/**
 * Magic-link HMAC-protected server-to-server endpoints.
 *
 * Exposes two endpoints callable ONLY from the platform (vobase-platform) via
 * a HMAC-signed request:
 *
 *   POST /api/auth/verify-magic-link
 *   POST /api/auth/set-active-organization
 *
 * ## HMAC contract (v2, extended)
 *
 * Both endpoints use the existing v2 2-key managed-channel HMAC contract
 * (see packages/template/modules/integrations/service/handshake.ts §signedPlatformRequest).
 * This plugin extends the v2 canonical payload by appending a timestamp segment:
 *
 *   canonical = `${method}|${pathOnly}|${sortedQuery}|${bodyDigest}|${timestamp}`
 *
 * Standard v2 (4 segments): `${method}|${pathOnly}|${sortedQuery}|${bodyDigest}`
 * Extended v2 (5 segments): adds `|${timestamp}` (unix ms) as the LAST segment.
 *
 * The platform always sends the extended form for auth-magic calls.
 * The verifyTenantSignature middleware is NOT used here (that middleware is
 * platform-facing for managed-whatsapp routes); instead we verify inline using
 * the same verifyRequest from @vobase/core.
 *
 * ## Replay prevention
 *
 * Each request carries a `nonce` body field (16-byte URL-safe-base64). The
 * nonce is recorded in infra.webhook_dedup (source='auth-magic') on first
 * arrival; a second request with the same nonce returns 409.
 *
 * ## Timestamp window
 *
 * Requests where |now - X-Vobase-Timestamp| > 5 minutes are rejected with
 * 401 timestamp_window_rejected.
 *
 * ## Token verification approach
 *
 * Rather than calling back through the HTTP stack, both endpoints use
 * `ctx.context.internalAdapter` directly — the same internal API that
 * better-auth's own endpoints use. For magic-link verify, we hash the token
 * with SHA-256 (base64url, no padding) to match the `storeToken: 'hashed'`
 * storage path, then call `findVerificationValue` + `createSession`.
 * For set-active-organization, we call `setActiveOrganization` on the org
 * adapter after verifying the user is a member.
 */

import { createHash } from 'node:crypto'
import { logger, verifyRequest, webhookDedup } from '@vobase/core'
import type { BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthEndpoint } from 'better-auth/api'
import { and, eq } from 'drizzle-orm'
import * as z from 'zod'

import type { ScopedDb } from '~/runtime'

// ─── Constants ───────────────────────────────────────────────────────────────

const TIMESTAMP_WINDOW_MS = 5 * 60_000

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

/**
 * Hash a magic-link token the same way better-auth does with `storeToken: 'hashed'`.
 * Source: better-auth/dist/plugins/magic-link/utils.mjs::defaultKeyHasher
 * Uses SubtleCrypto SHA-256 → base64url (no padding).
 */
async function hashToken(token: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  // base64url encode without padding — matches better-auth's defaultKeyHasher
  return Buffer.from(hash).toString('base64url').replace(/=/g, '')
}

function sortQueryString(rawQuery: string): string {
  if (!rawQuery) return ''
  const params = new URLSearchParams(rawQuery)
  const entries = [...params.entries()]
  entries.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))
  const sorted = new URLSearchParams()
  for (const [k, v] of entries) sorted.append(k, v)
  return sorted.toString()
}

// ─── HMAC verification ────────────────────────────────────────────────────────

type HmacCheckResult =
  | { ok: true }
  | { ok: false; reason: 'missing_headers' | 'timestamp_window_rejected' | 'body_digest_mismatch' | 'sig_invalid' }

/**
 * Verify the extended v2 HMAC from an inbound better-auth endpoint ctx.
 *
 * Headers expected: X-Vobase-Routine-Sig, X-Vobase-Rotation-Sig,
 * X-Vobase-Key-Version, X-Vobase-Sig-Version (must be '2'),
 * X-Vobase-Body-Digest, X-Vobase-Timestamp.
 *
 * Canonical payload (EXTENDED v2, 5 segments):
 *   `${method}|${pathOnly}|${sortedQuery}|${bodyDigest}|${timestamp}`
 */
function verifyExtendedV2Hmac(opts: {
  method: string
  fullPath: string
  rawBody: string
  headers: Headers
  hmacSecret: string
}): HmacCheckResult {
  const { method, fullPath, rawBody, headers, hmacSecret } = opts

  const sigVersion = headers.get('x-vobase-sig-version')
  const routineSig = headers.get('x-vobase-routine-sig')
  const rotationSig = headers.get('x-vobase-rotation-sig')
  const keyVersionRaw = headers.get('x-vobase-key-version')
  const advertisedDigest = headers.get('x-vobase-body-digest')
  const timestampRaw = headers.get('x-vobase-timestamp')

  if (sigVersion !== '2' || !routineSig || !rotationSig || !keyVersionRaw || !advertisedDigest || !timestampRaw) {
    return { ok: false, reason: 'missing_headers' }
  }

  // Timestamp window check
  const timestamp = Number(timestampRaw)
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > TIMESTAMP_WINDOW_MS) {
    return { ok: false, reason: 'timestamp_window_rejected' }
  }

  // Body digest check
  const actualDigest = sha256Hex(rawBody)
  if (advertisedDigest !== actualDigest) {
    return { ok: false, reason: 'body_digest_mismatch' }
  }

  // Derive canonical path/query
  let pathOnly: string
  let sortedQuery: string
  try {
    const url = new URL(fullPath, 'http://localhost')
    pathOnly = url.pathname
    sortedQuery = sortQueryString(url.search.slice(1))
  } catch {
    pathOnly = fullPath
    sortedQuery = ''
  }

  // Extended v2 canonical payload: 5 segments (method|path|query|digest|timestamp)
  const canonical = `${method}|${pathOnly}|${sortedQuery}|${actualDigest}|${timestamp}`

  const keyVersion = Number.parseInt(keyVersionRaw, 10)
  if (!Number.isFinite(keyVersion)) {
    return { ok: false, reason: 'missing_headers' }
  }

  const result = verifyRequest({
    body: canonical,
    routineSignature: routineSig,
    rotationSignature: rotationSig,
    keyVersion,
    // Platform-to-tenant auth calls use keyVersion 1; maxKeyVersionSeen=0 accepts any >= 1.
    maxKeyVersionSeen: 0,
    accept: [{ routineSecret: hmacSecret, rotationKey: hmacSecret, keyVersion }],
  })

  if (!result.ok) {
    return { ok: false, reason: 'sig_invalid' }
  }

  return { ok: true }
}

// ─── Nonce dedup ──────────────────────────────────────────────────────────────

/**
 * Record a nonce in infra.webhook_dedup (source = `source`).
 * Returns `true` if this is a DUPLICATE (nonce already seen), `false` if new.
 *
 * Uses the same conflict-on-insert dedup pattern as `checkAndRecordWebhook` in @vobase/core.
 */
async function checkAndRecordNonce(db: ScopedDb, nonce: string, source: string): Promise<boolean> {
  // biome-ignore lint/suspicious/noExplicitAny: drizzle scoped-db typing
  const dbAny = db as any
  const inserted: unknown[] = await dbAny
    .insert(webhookDedup)
    .values({ id: nonce, source, receivedAt: new Date() })
    .onConflictDoNothing()
    .returning({ id: webhookDedup.id })
  return inserted.length === 0 // zero rows = conflict = duplicate
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

/**
 * Build the magic-verify HMAC plugin.
 *
 * Requires `PLATFORM_HMAC_SECRET` env to be set (same env used by
 * platform-plugin.ts). If not set, endpoints return 401 unconditionally.
 */
export function magicVerifyHmacPlugin(db: ScopedDb): BetterAuthPlugin {
  const hmacSecret = process.env.PLATFORM_HMAC_SECRET ?? ''

  return {
    id: 'magic-verify-hmac',
    endpoints: {
      // ── POST /api/auth/verify-magic-link ─────────────────────────────────
      verifyMagicLinkHmac: createAuthEndpoint(
        '/verify-magic-link',
        { method: 'POST', requireHeaders: true },
        async (ctx) => {
          if (!hmacSecret) {
            logger.warn('[magic-verify] PLATFORM_HMAC_SECRET not set; rejecting verify-magic-link call')
            throw new APIError('UNAUTHORIZED', { message: 'unauthorized' })
          }

          // better-auth's router parses the JSON body before the endpoint runs,
          // so ctx.request?.text() returns '' (stream already consumed).
          // We re-serialize ctx.body to reconstruct the raw body string for the
          // HMAC digest check. The platform serializes with JSON.stringify so
          // key ordering is preserved through parse → stringify.
          const rawBody = ctx.body !== undefined && ctx.body !== null ? JSON.stringify(ctx.body) : ''

          const hmacResult = verifyExtendedV2Hmac({
            method: 'POST',
            fullPath: ctx.request?.url ?? '/api/auth/verify-magic-link',
            rawBody,
            headers: ctx.headers ?? new Headers(),
            hmacSecret,
          })

          if (!hmacResult.ok) {
            logger.warn({ reason: hmacResult.reason }, '[magic-verify] verify-magic-link HMAC rejected')
            if (hmacResult.reason === 'timestamp_window_rejected') {
              throw new APIError('UNAUTHORIZED', { message: 'timestamp_window_rejected' })
            }
            throw new APIError('UNAUTHORIZED', { message: 'unauthorized' })
          }

          // Parse body — ctx.body is already the parsed object
          let parsed: { token: string; nonce: string }
          try {
            const bodySchema = z.object({ token: z.string().min(1), nonce: z.string().min(1) })
            parsed = bodySchema.parse(ctx.body)
          } catch {
            throw new APIError('BAD_REQUEST', { message: 'invalid_body' })
          }

          const { token, nonce } = parsed

          // Replay prevention via infra.webhook_dedup
          const isDuplicate = await checkAndRecordNonce(db, nonce, 'auth-magic-verify')
          if (isDuplicate) {
            logger.warn({ nonce }, '[magic-verify] replay_rejected: nonce already seen')
            throw new APIError('CONFLICT', { message: 'replay_rejected' })
          }

          // Hash the token the same way better-auth does with storeToken: 'hashed'.
          // This is a SHA-256 base64url (no padding) hash — matches defaultKeyHasher in the plugin.
          let storedToken: string
          try {
            storedToken = await hashToken(token)
          } catch (err) {
            logger.warn(
              { error: err instanceof Error ? err.message : String(err) },
              '[magic-verify] token hashing failed',
            )
            throw new APIError('BAD_REQUEST', { message: 'INVALID_TOKEN' })
          }

          // Look up the verification row using the hashed token as the identifier.
          const tokenValue = await ctx.context.internalAdapter.findVerificationValue(storedToken)
          if (!tokenValue) {
            throw new APIError('BAD_REQUEST', { message: 'INVALID_TOKEN' })
          }
          if (tokenValue.expiresAt < new Date()) {
            await ctx.context.internalAdapter.deleteVerificationByIdentifier(storedToken)
            throw new APIError('BAD_REQUEST', { message: 'INVALID_TOKEN' })
          }

          // Parse the stored value — better-auth stores { email, name?, attempt? }
          let email: string
          let attempt = 0
          try {
            const stored = JSON.parse(tokenValue.value) as { email: string; name?: string; attempt?: number }
            email = stored.email
            attempt = stored.attempt ?? 0
          } catch {
            throw new APIError('BAD_REQUEST', { message: 'INVALID_TOKEN' })
          }

          // Check attempt limit (default = 1, matches magicLink plugin's default allowedAttempts)
          const MAX_ATTEMPTS = 1
          if (attempt >= MAX_ATTEMPTS) {
            await ctx.context.internalAdapter.deleteVerificationByIdentifier(storedToken)
            throw new APIError('BAD_REQUEST', { message: 'INVALID_TOKEN' })
          }

          // Consume the token (mark as used — increment past the limit)
          await ctx.context.internalAdapter.updateVerificationByIdentifier(storedToken, {
            value: JSON.stringify({ email, attempt: attempt + 1 }),
          })

          // Find the user — disableSignUp: true means we never create users here
          const existing = await ctx.context.internalAdapter.findUserByEmail(email)
          const user = existing?.user
          if (!user) {
            throw new APIError('BAD_REQUEST', { message: 'INVALID_TOKEN' })
          }

          // Create a new session
          const session = await ctx.context.internalAdapter.createSession(user.id)
          if (!session) {
            throw new APIError('INTERNAL_SERVER_ERROR', { message: 'session_create_failed' })
          }

          // Determine the active organization from the session (session.create.before hook in
          // auth/index.ts sets activeOrganizationId from the user's first membership).
          const organizationId = (session as { activeOrganizationId?: string }).activeOrganizationId ?? ''

          logger.info({ userId: user.id, organizationId }, '[magic-verify] magic-link verified, session created')

          return ctx.json({
            sessionToken: session.token,
            userId: user.id,
            expiresAt: (session.expiresAt as Date).toISOString(),
            organizationId,
          })
        },
      ),

      // ── POST /api/auth/set-active-organization ────────────────────────────
      setActiveOrganizationHmac: createAuthEndpoint(
        '/set-active-organization',
        { method: 'POST', requireHeaders: true },
        async (ctx) => {
          if (!hmacSecret) {
            logger.warn('[magic-verify] PLATFORM_HMAC_SECRET not set; rejecting set-active-organization call')
            throw new APIError('UNAUTHORIZED', { message: 'unauthorized' })
          }

          // Same as verify-magic-link: better-auth parses the JSON body before the
          // endpoint runs, so ctx.request?.text() returns '' (stream already consumed).
          // Re-serialize ctx.body to reconstruct the canonical raw body string.
          const rawBody = ctx.body !== undefined && ctx.body !== null ? JSON.stringify(ctx.body) : ''

          const hmacResult = verifyExtendedV2Hmac({
            method: 'POST',
            fullPath: ctx.request?.url ?? '/api/auth/set-active-organization',
            rawBody,
            headers: ctx.headers ?? new Headers(),
            hmacSecret,
          })

          if (!hmacResult.ok) {
            logger.warn({ reason: hmacResult.reason }, '[magic-verify] set-active-organization HMAC rejected')
            if (hmacResult.reason === 'timestamp_window_rejected') {
              throw new APIError('UNAUTHORIZED', { message: 'timestamp_window_rejected' })
            }
            throw new APIError('UNAUTHORIZED', { message: 'unauthorized' })
          }

          // Parse body — ctx.body is already the parsed object
          let parsed: { sessionToken: string; organizationId: string; nonce: string }
          try {
            const bodySchema = z.object({
              sessionToken: z.string().min(1),
              organizationId: z.string().min(1),
              nonce: z.string().min(1),
            })
            parsed = bodySchema.parse(ctx.body)
          } catch {
            throw new APIError('BAD_REQUEST', { message: 'invalid_body' })
          }

          const { sessionToken, organizationId, nonce } = parsed

          // Replay prevention
          const isDuplicate = await checkAndRecordNonce(db, nonce, 'auth-magic-set-org')
          if (isDuplicate) {
            logger.warn({ nonce }, '[magic-verify] replay_rejected: nonce already seen')
            throw new APIError('CONFLICT', { message: 'replay_rejected' })
          }

          // Find the session to validate sessionToken
          const sessionRow = await ctx.context.internalAdapter.findSession(sessionToken)
          if (!sessionRow) {
            throw new APIError('UNAUTHORIZED', { message: 'invalid_session' })
          }

          const userId = sessionRow.user.id

          // Verify the user is a member of the target organization before setting it active.
          // We read from the auth schema directly — better-auth's member table tracks membership.
          // biome-ignore lint/suspicious/noExplicitAny: drizzle scoped-db typing
          const dbAny = db as any
          // Dynamic import avoids circular dep: auth ← modules/team ← auth
          // biome-ignore lint/plugin/no-dynamic-import: avoids circular dependency (auth ← team schema ← auth)
          const { authMember } = await import('./schema')
          const [member] = await dbAny
            .select({ id: authMember.id })
            .from(authMember)
            .where(and(eq(authMember.userId, userId), eq(authMember.organizationId, organizationId)))
            .limit(1)

          if (!member) {
            logger.warn({ userId, organizationId }, '[magic-verify] set-active-organization: user not a member')
            throw new APIError('FORBIDDEN', { message: 'not_a_member' })
          }

          // Update the session's activeOrganizationId directly.
          // better-auth's internalAdapter.updateSession updates the session row.
          await ctx.context.internalAdapter.updateSession(sessionToken, {
            activeOrganizationId: organizationId,
          })

          logger.info({ userId, organizationId }, '[magic-verify] active organization set')
          return ctx.json({ ok: true, activeOrganizationId: organizationId })
        },
      ),
    },
  } satisfies BetterAuthPlugin
}
