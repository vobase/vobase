/**
 * Phone-OTP captor + `mintPhoneOtp` — staff-phone OTP issuance over the
 * platform's WhatsApp notification tier.
 *
 * ## Captor pattern
 *
 * better-auth's `phoneNumber` plugin invokes `sendOTP({ phoneNumber, code }, ctx)`
 * synchronously inside the `POST /phone-number/send-otp` endpoint. The endpoint
 * returns `{ message: 'code sent' }` and never surfaces the generated `code`
 * via its return value. We need that `code` to relay it ourselves through the
 * platform — so we register a per-call nonce via the shared {@link createCaptor}
 * helper BEFORE calling `auth.api.sendPhoneNumberOTP`, and the plugin's
 * `sendOTP` callback calls `phoneOtpCaptor.deliver(...)` to resolve our promise.
 *
 * Unlike magic-link, the `sendOTP` payload has NO `metadata` field. We thread
 * the nonce through an `x-captor-nonce` request header (set on the
 * `auth.api.sendPhoneNumberOTP({ headers })` call) and read it back from
 * `ctx.headers` inside the `sendOTP` callback.
 *
 * The captor mechanics (pending Map, nonce generation, 5 s timeout, error
 * wrapping) live in `auth/captor-pattern.ts`. This file owns the phone-OTP
 * pre-flight checks (staff-user existence, `vobase_platform_otp` template
 * approval gate) and the platform OTP-relay POST.
 *
 * ## Why a template-approval gate
 *
 * Meta's WhatsApp Cloud API rejects un-approved templates with HTTP 400. The
 * `channel_instances.config.metaTemplateApprovals` JSONB block tracks which
 * named templates the operator has confirmed Meta approved (manual flip via
 * Drizzle Studio after approval lands). If `vobase_platform_otp !== 'approved'`,
 * we fail fast with `phone_otp_template_unapproved` BEFORE invoking the captor
 * so we don't waste a verification row + relay attempt on a guaranteed-failure
 * send.
 */

// NOTE: @modules/* imports are intentionally NOT at the top level.
//
// The better-auth CLI loads this file's transitive import graph via jiti when
// running `check:auth-schema` (auth.config.ts → plugins.ts → phone-otp.ts).
// jiti cannot resolve the template's path aliases (@modules/*, @auth/*, ~/*),
// so any static import of @modules/* here would break `bun run check`.
//
// The captor + deliverPhoneOtp (consumed by plugins.ts::sendOTP) are safe
// because they only import from '@vobase/core', 'drizzle-orm', and sibling
// auth/ files — all resolvable by jiti. The @modules/* dependencies
// (findNotificationChannel, signedPlatformRequest) are only needed inside
// mintPhoneOtp, so they are loaded via dynamic import() at call time.
import { logger, notFound } from '@vobase/core'
import { eq } from 'drizzle-orm'

import { createCaptor } from './captor-pattern'
import type { Auth } from './index'
import { authUser } from './schema'

/**
 * Thrown by `mintPhoneOtp` when the mint operation fails (captor timeout,
 * better-auth error, user not found, template unapproved, platform relay
 * error). The dispatcher catches this by `instanceof` check and writes
 * `automation_runs(status='failed', errorMessage='phone_otp_mint_failed')`
 * without retrying.
 */
export class PhoneOtpMintError extends Error {
  override name = 'PhoneOtpMintError'
  cause: unknown
  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    this.cause = options?.cause
  }
}

/** 5 s — matches §8a.11.1 captor timeout discipline. */
const CAPTOR_TIMEOUT_MS = 5_000

/** OTP TTL relayed to the platform — matches better-auth's `expiresIn: 600`. */
const OTP_EXPIRES_IN_SEC = 600

/** Meta template name. User-approved variant — NOT `vobase_phone_otp`. */
const PHONE_OTP_TEMPLATE_NAME = 'vobase_platform_otp'

/** Header used to thread the captor nonce through better-auth's sendOTP plumbing. */
export const CAPTOR_NONCE_HEADER = 'x-captor-nonce'

/**
 * Per-mint payload threaded through better-auth into the `sendOTP` callback.
 * The captor's sender forwards `phoneNumber` to better-auth's
 * `sendPhoneNumberOTP` body; the `auth` handle is per-call because this module
 * is stateless w.r.t. it (mirrors `auth/magic-link.ts`).
 */
interface MintPayload {
  phoneNumber: string
  auth: Auth
}

interface DeliveredCode {
  /** 6-digit OTP minted by better-auth. */
  code: string
  phoneNumber: string
}

/**
 * Shared captor instance. Stateful in the pending-Map sense — exported so the
 * better-auth `sendOTP` callback in `auth/plugins.ts` can call `deliver`.
 */
export const phoneOtpCaptor = createCaptor<MintPayload, DeliveredCode>({
  name: 'phone-otp',
  timeoutMs: CAPTOR_TIMEOUT_MS,
  errorClass: PhoneOtpMintError,
  sender: async (payload, nonce) => {
    await payload.auth.api.sendPhoneNumberOTP({
      body: { phoneNumber: payload.phoneNumber },
      headers: new Headers({ [CAPTOR_NONCE_HEADER]: nonce }),
    })
  },
})

/**
 * Extract the captor nonce + result from a better-auth `sendOTP` invocation.
 * Adapts the plugin's `({ phoneNumber, code }, ctx)` shape into the captor's
 * `{ metadata, result }` contract. The nonce travels in the
 * `x-captor-nonce` request header set by `phoneOtpCaptor.sender`.
 */
export function deliverPhoneOtp(args: { phoneNumber: string; code: string; ctxHeaders: Headers | undefined }): void {
  const nonce = args.ctxHeaders?.get(CAPTOR_NONCE_HEADER) ?? undefined
  phoneOtpCaptor.deliver({
    metadata: nonce ? { nonce } : undefined,
    result: { code: args.code, phoneNumber: args.phoneNumber },
  })
}

// Minimal Drizzle-compatible db shape for the user existence check + channel
// config read. Callers pass ScopedDb; the type is narrowed here to avoid
// importing ~/runtime (which would create a circular dep: auth ← runtime ← auth).
interface DbForUserLookup {
  // biome-ignore lint/suspicious/noExplicitAny: drizzle select returns unknown table shape
  select: () => any
}

export interface MintInput {
  userId: string
  /** E.164 with leading `+` — validated by `E164_RE` upstream. */
  phoneNumber: string
  organizationId: string
}

export interface MintResult {
  /** 6-digit OTP. Never persist in plaintext — relay-only. */
  code: string
  /** ISO 8601 — `OTP_EXPIRES_IN_SEC` from issuance (10 minutes). */
  expiresAt: string
}

/**
 * Issue a phone-OTP for an existing staff user and relay it to their WhatsApp
 * number via the platform's `vobase_platform_otp` template. Returns the OTP +
 * expiry so callers can also write it into an audit row if desired (the OTP is
 * already relayed by the time this resolves).
 *
 * ## Constraints
 * - TTL is 10 minutes (matches the platform-side template's wording).
 * - Pre-flight: throws `PhoneOtpMintError('staff_user_not_found')` if the
 *   `userId` has no `auth_user` row.
 * - Pre-flight: throws `PhoneOtpMintError('phone_otp_template_unapproved')`
 *   when `channel_instances.config.metaTemplateApprovals.vobase_platform_otp`
 *   is anything other than `'approved'` (defends Meta-side 400s before we burn
 *   a captor + relay attempt).
 * - Captor timeout: 5 s — if better-auth's `sendOTP` is skipped (future config
 *   change), the mint rejects with `captor_timeout` wrapped in
 *   `PhoneOtpMintError`.
 * - This function MUST only be called post-commit (Principle 6 — plan §8a.1).
 *   Never call from inside a wake-trigger renderer or `WorkspaceMaterializerFactory`.
 *
 * @param auth - better-auth instance (from `createAuth(db)`)
 * @param db - Drizzle DB instance (user existence pre-flight + channel read)
 * @param input - mint parameters
 */
export async function mintPhoneOtp(auth: Auth, db: DbForUserLookup, input: MintInput): Promise<MintResult> {
  const { userId, phoneNumber, organizationId } = input

  // Pre-flight 1: verify the user exists. We fail fast here so callers get a
  // clean `staff_user_not_found` instead of a downstream better-auth surprise.
  let rows: unknown[]
  try {
    rows = await db.select().from(authUser).where(eq(authUser.id, userId)).limit(1)
  } catch (err) {
    throw new PhoneOtpMintError('phone_otp_mint_failed', { cause: err })
  }
  if (!(rows as Array<unknown>)[0]) {
    throw new PhoneOtpMintError('phone_otp_mint_failed', { cause: notFound('staff_user_not_found') })
  }

  // Pre-flight 2: template-approval gate. The channel-instances service reads
  // the org's notification-tier WhatsApp channel; the operator-curated
  // `metaTemplateApprovals` jsonb tells us whether Meta has greenlit
  // `vobase_platform_otp`. Missing channel / missing key / non-`'approved'`
  // value all fail the same way — we never relay an unapproved template.
  //
  // Dynamic import — see module-level NOTE above for why @modules/* cannot be
  // a static top-level import in this file.
  // biome-ignore lint/plugin/no-dynamic-import: @modules/* cannot be a static import here (jiti compat — see NOTE)
  const { findNotificationChannel } = await import('@modules/channels/service/instances')
  const channel = await findNotificationChannel(organizationId)
  const config = (channel?.config ?? null) as { metaTemplateApprovals?: Record<string, unknown> } | null
  const approval = config?.metaTemplateApprovals?.[PHONE_OTP_TEMPLATE_NAME]
  if (approval !== 'approved') {
    throw new PhoneOtpMintError('phone_otp_template_unapproved', {
      cause: { templateName: PHONE_OTP_TEMPLATE_NAME, status: approval ?? null },
    })
  }

  // Captor mints the OTP via better-auth's `sendPhoneNumberOTP`. The shared
  // helper owns the pending Map, nonce generation, 5 s timeout, and
  // `PhoneOtpMintError`-wrapped failure shape.
  let captured: DeliveredCode
  try {
    captured = await phoneOtpCaptor.mint({ phoneNumber, auth })
  } catch (err) {
    // Captor already wraps in PhoneOtpMintError via `errorClass`, but re-wrap
    // with the canonical `phone_otp_mint_failed` message so the dispatcher's
    // error-message check is uniform across mint failure modes.
    if (err instanceof PhoneOtpMintError) {
      throw new PhoneOtpMintError('phone_otp_mint_failed', { cause: err.cause ?? err })
    }
    throw new PhoneOtpMintError('phone_otp_mint_failed', { cause: err })
  }

  // Relay the OTP to the staff WhatsApp number via the platform. The platform
  // endpoint resolves to a `vobase_platform_otp` Meta template send keyed on
  // tenant + staff phone. HMAC v2 signing is reused from the integrations
  // module so the platform's tenant-auth path is unchanged.
  const platformBaseUrl = process.env.VITE_PLATFORM_URL ?? ''
  const tenantId = process.env.PLATFORM_TENANT_ID ?? ''
  const tenantHmacSecret = process.env.PLATFORM_HMAC_SECRET ?? ''
  if (!platformBaseUrl || !tenantId || !tenantHmacSecret) {
    throw new PhoneOtpMintError('phone_otp_mint_failed', {
      cause: new Error('platform credentials missing (VITE_PLATFORM_URL / PLATFORM_TENANT_ID / PLATFORM_HMAC_SECRET)'),
    })
  }
  const body = JSON.stringify({
    staffPhoneE164: phoneNumber,
    code: captured.code,
    expiresInSec: OTP_EXPIRES_IN_SEC,
  })
  // Dynamic import — see module-level NOTE above.
  // biome-ignore lint/plugin/no-dynamic-import: @modules/* cannot be a static import here (jiti compat — see NOTE)
  const { signedPlatformRequest } = await import('@modules/integrations/service/handshake')
  try {
    const { res } = await signedPlatformRequest({
      method: 'POST',
      platformBaseUrl,
      tenantId,
      tenantHmacSecret,
      path: '/api/whatsapp/otp',
      body,
    })
    if (!res.ok) {
      let payload: unknown
      try {
        payload = await res.json()
      } catch {
        payload = null
      }
      logger.error({ status: res.status, payload, organizationId, userId }, '[auth:phone-otp] platform relay failed')
      throw new PhoneOtpMintError('phone_otp_mint_failed', {
        cause: { platformStatus: res.status, platformPayload: payload },
      })
    }
  } catch (err) {
    if (err instanceof PhoneOtpMintError) throw err
    throw new PhoneOtpMintError('phone_otp_mint_failed', { cause: err })
  }

  // Date.now() is acceptable here: this is POST-COMMIT (Principle 6), NOT inside
  // a wake-trigger renderer (Principle 3 — deterministic frozen-snapshot zone).
  const expiresAt = new Date(Date.now() + OTP_EXPIRES_IN_SEC * 1000).toISOString()

  return { code: captured.code, expiresAt }
}
