/**
 * WhatsApp Embedded Signup HTTP surface — mounted at
 * `/api/channels/whatsapp/signup/*` by the channels umbrella router.
 *
 * Four endpoints — all behind `requireOrganization`:
 *
 *   POST /start
 *     Mints a single-use, 5-minute CSRF nonce bound to (orgId, sessionId)
 *     from the better-auth session cookie. The frontend POSTs the nonce
 *     back to /exchange together with the FB.login result.
 *
 *   POST /exchange
 *     1. Per-`(userId, orgId)` rate-limit: 10 SUCCESSFUL exchanges/h.
 *     2. Consume the nonce atomically (DELETE…RETURNING). Replay or
 *        session-mismatch → 401.
 *     3. POST graph.facebook.com/v22.0/oauth/access_token. Failure → 502.
 *     4. MANDATORY: GET /debug_token. Reject if `data.app_id` ≠ META_APP_ID
 *        or the user-claimed `wabaId` is not in `granular_scopes[].target_ids`.
 *        Persist NOTHING on mismatch. Per-source-IP failure bucket also bumped.
 *     5. Encrypt the access token via envelope encryption; persist on
 *        `channel_instances.config`. Mark `setupStage='subscribing'`.
 *     6. Return `{ instanceId, displayPhoneNumber }`.
 *
 *   GET /callback?handoff=<JWT>
 *     Platform-handoff landing. When the tenant is platform-wired, WhatsApp
 *     onboarding runs on the platform's Facebook entry point; the platform
 *     exchanges the code and 302s the browser here with a short-lived JWT
 *     (signed under `PLATFORM_HMAC_SECRET`) carrying the self-WABA
 *     credentials. This handler verifies the JWT, persists the channel via
 *     the same `persistSelfInstance` writer as `/exchange`, and redirects to
 *     `/channels`. No platform→tenant call — the browser is the only courier.
 *
 *   POST /finish/:instanceId
 *     Re-enqueues the `whatsapp:setup` job. Idempotent — used by the admin UI
 *     to retry after `setupStage='failed'`. Optional body `{ resync: ["history"
 *     | "smb_app_state_sync"] }` clears the matching once-only coexistence sync
 *     guard first, so the re-run re-requests an SMB App Data sync that Meta
 *     accepted but never delivered (e.g. history approved on-phone post-request).
 *
 * Security guardrails:
 *   - Nonce consume is atomic DELETE…RETURNING; replay never returns true twice.
 *   - debug_token validation is mandatory BEFORE persistence — the CSRF nonce
 *     alone doesn't bind the WABA to the session, so an attacker who hijacks
 *     the FB.login flow could otherwise graft an attacker-controlled WABA
 *     onto the victim org.
 *   - No request body is logged; sanitised metadata only on `console.error`.
 */
import { randomUUID } from 'node:crypto'
import { type OrganizationEnv, requireOrganization } from '@auth/middleware'
import { zValidator } from '@hono/zod-validator'
import { clearCoexistenceSyncGuards } from '@modules/channels/adapters/whatsapp/coexistence-sync'
import {
  buildEncryptedAccessTokenField,
  loadMetaOAuthConfigFromEnv,
  loadSignupConfigIdsFromEnv,
  parseWhatsappInstanceConfig,
  type WhatsappInstanceConfig,
} from '@modules/channels/adapters/whatsapp/instance-config'
import { WHATSAPP_SETUP_JOB, type WhatsappSetupJobData } from '@modules/channels/adapters/whatsapp/jobs/setup'
import {
  exchangeCodeForToken,
  type MetaOAuthError,
  verifyAccessTokenViaDebugToken,
} from '@modules/channels/adapters/whatsapp/meta-oauth'
import { createInstance, getInstance, listInstances, updateInstance } from '@modules/channels/service/instances'
import { consumeNonce, mintNonce } from '@modules/channels/service/signup-nonces'
import { getJobs, getRateLimits, getRequireAdmin } from '@modules/channels/service/state'
import { Hono } from 'hono'
import { jwtVerify } from 'jose'
import { z } from 'zod'

import { sourceIpFromHeaders } from '~/runtime/request-ip'

const exchangeBody = z.object({
  code: z.string().min(1).max(2048),
  phoneNumberId: z.string().min(1).max(64),
  wabaId: z.string().min(1).max(64),
  mode: z.enum(['cloud', 'coexistence']),
  nonce: z.string().min(8).max(128),
  displayPhoneNumber: z.string().min(1).max(32).optional(),
})

/**
 * Shape of the `wa` claim inside the platform-handoff JWT. Validated after the
 * HS256 signature check so a tampered-but-unsigned payload still can't slip a
 * malformed credential bag through.
 */
const handoffWaSchema = z.object({
  accessToken: z.string().min(1),
  wabaId: z.string().min(1).max(64),
  phoneNumberId: z.string().min(1).max(64),
  displayPhoneNumber: z.string().max(32).nullable().optional(),
  appId: z.string().min(1),
  appSecret: z.string().min(1),
  apiVersion: z.string().min(1).max(16),
  coexistence: z.boolean(),
})

/** Optional body for `POST /finish/:instanceId` — clears once-only coexistence sync guards so the re-enqueued setup job re-fires them. */
const finishBody = z.object({
  resync: z.array(z.enum(['history', 'smb_app_state_sync'])).optional(),
})

const invalidBody = (
  result: { success: boolean; error?: { issues: unknown } },
  c: { json: (b: unknown, s: number) => Response },
) => (result.success ? undefined : c.json({ error: 'invalid_body', issues: result.error?.issues }, 400))

const RATE_LIMIT_WINDOW_SECONDS = 60 * 60 // 1 hour
const RATE_LIMIT_MAX_SUCCESSES = 10
const VALIDATION_FAILURE_BUCKET_PER_MINUTE = 60
const VALIDATION_FAILURE_WINDOW_SECONDS = 60

async function bumpValidationFailureBucket(headers: Headers): Promise<void> {
  const rl = getRateLimits()
  if (!rl) return
  const ip = sourceIpFromHeaders(headers)
  await rl.acquire(
    `wa_signup_validation_fail:${ip}`,
    VALIDATION_FAILURE_BUCKET_PER_MINUTE,
    VALIDATION_FAILURE_WINDOW_SECONDS,
  )
}

interface SelfInstanceParams {
  accessToken: string
  wabaId: string
  phoneNumberId: string
  displayPhoneNumber: string | null
  appId: string
  appSecret: string
  /** Optional — `loadMetaOAuthConfigFromEnv` types it loosely; the adapter falls back to env. */
  apiVersion?: string
  coexistence: boolean
}

/**
 * Shared writer for a self-mode WhatsApp `channel_instances` row — used by both
 * the in-tenant Embedded Signup `/exchange` and the platform-handoff
 * `/callback`. Envelope-encrypts the access token AND the Meta App Secret
 * (neither plaintext value lands in any persistent store), mints a webhook
 * verify token so the setup job can register a per-WABA callback override,
 * and enqueues the post-signup `whatsapp:setup` job.
 *
 * Idempotent on `(organizationId, self-mode, phoneNumberId)`: a re-run
 * reactivates the matching row — including a soft-released one — rather than
 * inserting a duplicate, and reuses its existing verify token so the
 * registered callback URL stays stable.
 */
async function persistSelfInstance(
  organizationId: string,
  params: SelfInstanceParams,
): Promise<{ instanceId: string; displayPhoneNumber: string | null; coexistence: boolean }> {
  // Resolve an existing self-mode row for this number — released rows
  // included, so a reconnect after disconnect reactivates instead of
  // duplicating.
  const existing = (await listInstances(organizationId, 'whatsapp', { includeReleased: true })).find(
    (i) => i.config.mode === 'self' && i.config.phoneNumberId === params.phoneNumberId,
  )
  // Keep the verify token stable across re-runs so the per-WABA override
  // callback URL doesn't need re-verification.
  const existingVerifyToken =
    existing && typeof existing.config.webhookVerifyToken === 'string' ? existing.config.webhookVerifyToken : undefined
  const webhookVerifyToken = existingVerifyToken ?? randomUUID()

  const config: WhatsappInstanceConfig = {
    mode: 'self',
    coexistence: params.coexistence,
    wabaId: params.wabaId,
    phoneNumberId: params.phoneNumberId,
    displayPhoneNumber: params.displayPhoneNumber ?? undefined,
    appId: params.appId,
    apiVersion: params.apiVersion,
    appSecretEnvelope: buildEncryptedAccessTokenField(params.appSecret),
    webhookVerifyToken,
    accessTokenEnvelope: buildEncryptedAccessTokenField(params.accessToken),
  }
  const configJson = config as unknown as Record<string, unknown>
  const displayName = params.displayPhoneNumber ?? `WhatsApp ${params.phoneNumberId}`

  const instance = existing
    ? await updateInstance(existing.id, organizationId, {
        displayName,
        config: configJson,
        status: 'active',
        lastError: null,
      })
    : await createInstance({
        organizationId,
        channel: 'whatsapp',
        role: 'customer',
        displayName,
        config: configJson,
        webhookSecret: null,
      })

  const jobs = getJobs()
  if (jobs) {
    const jobData: WhatsappSetupJobData = { instanceId: instance.id, organizationId }
    void jobs.send(WHATSAPP_SETUP_JOB, jobData).catch((err) => {
      console.error('[wa-signup] enqueue setup job failed:', (err as Error).message)
    })
  }

  return {
    instanceId: instance.id,
    displayPhoneNumber: params.displayPhoneNumber ?? null,
    coexistence: params.coexistence,
  }
}

const app = new Hono<OrganizationEnv>()
  .use('*', requireOrganization)
  .post('/start', async (c) => {
    const session = c.get('session')
    const organizationId = c.get('organizationId')
    const sessionId = session.session.id
    if (!sessionId) {
      return c.json({ error: 'no_session_id' }, 401)
    }

    const configIds = loadSignupConfigIdsFromEnv()
    const { nonce, expiresAt } = await mintNonce({ organizationId, sessionId })
    return c.json({
      nonce,
      expiresAt: expiresAt.toISOString(),
      appId: process.env.META_APP_ID ?? null,
      apiVersion: process.env.META_APP_API_VERSION ?? 'v22.0',
      configIdCloud: configIds.cloud,
      configIdCoexistence: configIds.coexistence,
    })
  })
  .post('/exchange', zValidator('json', exchangeBody, invalidBody), async (c) => {
    const session = c.get('session')
    const organizationId = c.get('organizationId')
    const userId = session.user.id
    const sessionId = session.session.id
    if (!sessionId) {
      return c.json({ error: 'no_session_id' }, 401)
    }

    const data = c.req.valid('json')

    const ok = await consumeNonce({ nonce: data.nonce, organizationId, sessionId })
    if (!ok) {
      void bumpValidationFailureBucket(c.req.raw.headers)
      return c.json({ error: 'invalid_or_expired_nonce' }, 401)
    }

    let oauthConfig: ReturnType<typeof loadMetaOAuthConfigFromEnv>
    try {
      oauthConfig = loadMetaOAuthConfigFromEnv()
    } catch (err) {
      console.error('[wa-signup] env misconfigured:', (err as Error).message)
      return c.json({ error: 'server_misconfigured' }, 500)
    }

    let accessToken: string
    try {
      const exchanged = await exchangeCodeForToken(data.code, oauthConfig)
      accessToken = exchanged.accessToken
    } catch (err) {
      const meta = err as MetaOAuthError
      console.error(`[wa-signup] code exchange failed: kind=${meta.kind ?? 'unknown'} code=${meta.code ?? 'none'}`)
      void bumpValidationFailureBucket(c.req.raw.headers)
      return c.json({ error: 'oauth_exchange_failed' }, 502)
    }

    try {
      const debug = await verifyAccessTokenViaDebugToken(accessToken, oauthConfig)
      if (!debug.isValid) {
        void bumpValidationFailureBucket(c.req.raw.headers)
        return c.json({ error: 'token_not_valid' }, 401)
      }
      if (debug.appId !== oauthConfig.appId) {
        console.error(`[wa-signup] app_id mismatch: token app_id=${debug.appId} expected=${oauthConfig.appId}`)
        void bumpValidationFailureBucket(c.req.raw.headers)
        return c.json({ error: 'app_id_mismatch' }, 401)
      }
      if (!debug.targetIds.includes(data.wabaId)) {
        console.error(
          `[wa-signup] wabaId mismatch: claimed=${data.wabaId} token target_ids=${debug.targetIds.join(',')}`,
        )
        void bumpValidationFailureBucket(c.req.raw.headers)
        return c.json({ error: 'wabaId_mismatch' }, 401)
      }
    } catch (err) {
      const meta = err as MetaOAuthError
      console.error(`[wa-signup] debug_token failed: kind=${meta.kind ?? 'unknown'} code=${meta.code ?? 'none'}`)
      void bumpValidationFailureBucket(c.req.raw.headers)
      return c.json({ error: 'debug_token_failed' }, 502)
    }

    // Per-(userId, orgId) success bucket. Acquired AFTER all validation has
    // passed so that validation failures don't burn a slot — a low-priv
    // member's bad attempts cannot DoS-lock-out the org admin's success
    // bucket. Failure floods are gated by the per-IP failure bucket above.
    const rl = getRateLimits()
    if (rl) {
      const successKey = `wa_signup_exchange:${userId}:${organizationId}`
      const limit = await rl.acquire(successKey, RATE_LIMIT_MAX_SUCCESSES, RATE_LIMIT_WINDOW_SECONDS)
      if (!limit.ok) {
        const headers: Record<string, string> = {}
        if (limit.retryAfter) {
          const seconds = Math.max(1, Math.ceil((limit.retryAfter.getTime() - Date.now()) / 1000))
          headers['Retry-After'] = String(seconds)
        }
        return c.json({ error: 'rate_limited' }, 429, headers)
      }
    }

    // Encrypt + persist via the shared self-instance writer.
    const result = await persistSelfInstance(organizationId, {
      accessToken,
      wabaId: data.wabaId,
      phoneNumberId: data.phoneNumberId,
      displayPhoneNumber: data.displayPhoneNumber ?? null,
      appId: oauthConfig.appId,
      appSecret: oauthConfig.appSecret,
      apiVersion: oauthConfig.apiVersion,
      coexistence: data.mode === 'coexistence',
    })

    return c.json(result, 201)
  })
  .get('/callback', async (c) => {
    const session = c.get('session')
    const organizationId = c.get('organizationId')
    const sessionId = session.session.id
    const handoff = c.req.query('handoff') ?? ''
    const platformSecret = process.env.PLATFORM_HMAC_SECRET ?? ''
    if (!handoff || !platformSecret || !sessionId) {
      return c.redirect('/channels?wa_error=platform_not_configured')
    }

    // The HS256 signature under PLATFORM_HMAC_SECRET proves the platform
    // minted this handoff (per-tenant secret); `jwtVerify` enforces expiry.
    // The `nonce` consumed below is what binds the handoff to a specific
    // org + session — the signature alone can't, since one PLATFORM_HMAC_SECRET
    // covers every org on the deployment.
    let wa: z.infer<typeof handoffWaSchema>
    let handoffNonce: string
    try {
      const key = new TextEncoder().encode(platformSecret)
      const { payload } = await jwtVerify(handoff, key, { algorithms: ['HS256'] })
      if (payload.kind !== 'whatsapp-signup') {
        throw new Error('unexpected token kind')
      }
      handoffNonce = typeof payload.nonce === 'string' ? payload.nonce : ''
      wa = handoffWaSchema.parse(payload.wa)
    } catch (err) {
      console.error('[wa-signup] handoff verification failed:', (err as Error).message)
      return c.redirect('/channels?wa_error=invalid_handoff')
    }

    // Consume the nonce minted at `/start`. It is bound to (organizationId,
    // sessionId), so this rejects a handoff that is replayed, applied to a
    // different org, or carried by a different session than the one that
    // started signup. Single-use — atomic DELETE…RETURNING.
    const nonceOk = await consumeNonce({ nonce: handoffNonce, organizationId, sessionId })
    if (!nonceOk) {
      console.error('[wa-signup] handoff nonce rejected — replay, cross-org, or session mismatch')
      return c.redirect('/channels?wa_error=invalid_handoff')
    }

    try {
      await persistSelfInstance(organizationId, {
        accessToken: wa.accessToken,
        wabaId: wa.wabaId,
        phoneNumberId: wa.phoneNumberId,
        displayPhoneNumber: wa.displayPhoneNumber ?? null,
        appId: wa.appId,
        appSecret: wa.appSecret,
        apiVersion: wa.apiVersion,
        coexistence: wa.coexistence,
      })
    } catch (err) {
      console.error('[wa-signup] callback persist failed:', (err as Error).message)
      return c.redirect('/channels?wa_error=persist_failed')
    }

    return c.redirect('/channels')
  })
  .post(
    '/finish/:instanceId',
    // biome-ignore lint/suspicious/useAwait: Hono middleware contract requires async signature
    async (c, next) => {
      // Re-enqueueing the WhatsApp setup job rotates the webhook subscription;
      // staff-level members shouldn't be able to bounce the integration. `/start`
      // and `/exchange` stay at requireOrganization (any org member can connect
      // a number) — only the retry hatch is admin-gated.
      const mw = getRequireAdmin()
      if (!mw) return c.json({ error: 'auth not initialised' }, 503)
      return mw(c, next)
    },
    async (c) => {
      const organizationId = c.get('organizationId')
      const instanceId = c.req.param('instanceId')
      const instance = await getInstance(instanceId)
      if (!instance || instance.organizationId !== organizationId) {
        return c.json({ error: 'not_found' }, 404)
      }
      if (instance.channel !== 'whatsapp') {
        return c.json({ error: 'wrong_channel' }, 400)
      }
      const jobs = getJobs()
      if (!jobs) {
        return c.json({ error: 'jobs_unavailable' }, 503)
      }

      // Coexistence re-sync hatch. Each SMB App Data sync is once-only-guarded by
      // a `coexistenceHistory.{history,contacts}RequestedAt` timestamp, so the
      // setup job never re-fires a sync whose request already succeeded. But Meta
      // can accept the request and still deliver nothing — e.g. the business
      // approves the on-phone "sync older chats" prompt only AFTER the first
      // `history` request, so the burst is never sent and the guard permanently
      // blocks a retry. An admin POSTs `{ resync: ["history"] }` to clear that
      // guard (and the stale surfaced status) so the re-enqueued setup job
      // re-requests the burst. Body is optional — a bare retry stays legacy.
      // Distinguish "no body" (a legacy bare retry — fine) from "a body was sent
      // but is malformed" (client error — surface it, don't silently degrade to a
      // bare retry that clears no guard while returning 200). An empty/absent
      // body fails JSON parse → treated as the legacy bare retry.
      let resync: Array<'history' | 'smb_app_state_sync'> = []
      let hasBody = true
      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        hasBody = false
      }
      if (hasBody) {
        const parsed = finishBody.safeParse(body)
        if (!parsed.success) {
          return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
        }
        resync = parsed.data.resync ?? []
      }
      if (resync.length > 0) {
        const cfg = parseWhatsappInstanceConfig(instance.config)
        const coexistenceHistory = clearCoexistenceSyncGuards(cfg.coexistenceHistory, resync)
        await updateInstance(instanceId, organizationId, {
          config: { ...(instance.config as Record<string, unknown>), coexistenceHistory },
        })
      }

      const jobData: WhatsappSetupJobData = { instanceId, organizationId }
      await jobs.send(WHATSAPP_SETUP_JOB, jobData)
      return c.json({ enqueued: true, ...(resync.length > 0 ? { resynced: resync } : {}) })
    },
  )

export default app
