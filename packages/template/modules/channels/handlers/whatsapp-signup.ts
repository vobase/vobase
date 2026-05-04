/**
 * WhatsApp Embedded Signup HTTP surface — mounted at
 * `/api/channels/whatsapp/signup/*` by the channels umbrella router.
 *
 * Three endpoints — all behind `requireOrganization`:
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
 *   POST /finish/:instanceId
 *     Re-enqueues the `whatsapp:setup` job. Idempotent — used by the admin UI
 *     to retry after `setupStage='failed'`.
 *
 * Security guardrails:
 *   - Nonce consume is atomic DELETE…RETURNING; replay never returns true twice.
 *   - debug_token validation is mandatory BEFORE persistence — the CSRF nonce
 *     alone doesn't bind the WABA to the session, so an attacker who hijacks
 *     the FB.login flow could otherwise graft an attacker-controlled WABA
 *     onto the victim org.
 *   - No request body is logged; sanitised metadata only on `console.error`.
 */
import { type OrganizationEnv, requireOrganization } from '@auth/middleware'
import { zValidator } from '@hono/zod-validator'
import {
  buildEncryptedAccessTokenField,
  loadMetaOAuthConfigFromEnv,
  loadSignupConfigIdsFromEnv,
  type WhatsappInstanceConfig,
} from '@modules/channels/adapters/whatsapp/instance-config'
import { WHATSAPP_SETUP_JOB, type WhatsappSetupJobData } from '@modules/channels/adapters/whatsapp/jobs/setup'
import {
  exchangeCodeForToken,
  type MetaOAuthError,
  verifyAccessTokenViaDebugToken,
} from '@modules/channels/adapters/whatsapp/meta-oauth'
import { createInstance, getInstance } from '@modules/channels/service/instances'
import { consumeNonce, mintNonce } from '@modules/channels/service/signup-nonces'
import { getJobs, getRateLimits } from '@modules/channels/service/state'
import { Hono } from 'hono'
import { z } from 'zod'

const exchangeBody = z.object({
  code: z.string().min(1).max(2048),
  phoneNumberId: z.string().min(1).max(64),
  wabaId: z.string().min(1).max(64),
  mode: z.enum(['cloud', 'coexistence']),
  nonce: z.string().min(8).max(128),
  displayPhoneNumber: z.string().min(1).max(32).optional(),
})

const invalidBody = (
  result: { success: boolean; error?: { issues: unknown } },
  c: { json: (b: unknown, s: number) => Response },
) => (result.success ? undefined : c.json({ error: 'invalid_body', issues: result.error?.issues }, 400))

const RATE_LIMIT_WINDOW_SECONDS = 60 * 60 // 1 hour
const RATE_LIMIT_MAX_SUCCESSES = 10
const VALIDATION_FAILURE_BUCKET_PER_MINUTE = 60
const VALIDATION_FAILURE_WINDOW_SECONDS = 60

function sourceIpFromHeaders(headers: Headers): string {
  const xff = headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first && first.length > 0) return first
  }
  return headers.get('x-real-ip')?.trim() || 'unknown'
}

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
      await bumpValidationFailureBucket(c.req.raw.headers)
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
      await bumpValidationFailureBucket(c.req.raw.headers)
      return c.json({ error: 'oauth_exchange_failed' }, 502)
    }

    try {
      const debug = await verifyAccessTokenViaDebugToken(accessToken, oauthConfig)
      if (!debug.isValid) {
        await bumpValidationFailureBucket(c.req.raw.headers)
        return c.json({ error: 'token_not_valid' }, 401)
      }
      if (debug.appId !== oauthConfig.appId) {
        console.error(`[wa-signup] app_id mismatch: token app_id=${debug.appId} expected=${oauthConfig.appId}`)
        await bumpValidationFailureBucket(c.req.raw.headers)
        return c.json({ error: 'app_id_mismatch' }, 401)
      }
      if (!debug.targetIds.includes(data.wabaId)) {
        console.error(
          `[wa-signup] wabaId mismatch: claimed=${data.wabaId} token target_ids=${debug.targetIds.join(',')}`,
        )
        await bumpValidationFailureBucket(c.req.raw.headers)
        return c.json({ error: 'wabaId_mismatch' }, 401)
      }
    } catch (err) {
      const meta = err as MetaOAuthError
      console.error(`[wa-signup] debug_token failed: kind=${meta.kind ?? 'unknown'} code=${meta.code ?? 'none'}`)
      await bumpValidationFailureBucket(c.req.raw.headers)
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

    // Encrypt + persist. The plaintext token never lives in any persistent
    // store; only the envelope ciphertext does.
    const accessTokenEnvelope = buildEncryptedAccessTokenField(accessToken)
    const config: WhatsappInstanceConfig = {
      mode: 'self',
      coexistence: data.mode === 'coexistence',
      wabaId: data.wabaId,
      phoneNumberId: data.phoneNumberId,
      displayPhoneNumber: data.displayPhoneNumber,
      appId: oauthConfig.appId,
      apiVersion: oauthConfig.apiVersion,
      accessTokenEnvelope,
    }

    const instance = await createInstance({
      organizationId,
      channel: 'whatsapp',
      role: 'customer',
      displayName: data.displayPhoneNumber ?? `WhatsApp ${data.phoneNumberId}`,
      config: config as unknown as Record<string, unknown>,
      webhookSecret: null,
    })

    const jobs = getJobs()
    const jobData: WhatsappSetupJobData = { instanceId: instance.id, organizationId }
    if (jobs) {
      void jobs.send(WHATSAPP_SETUP_JOB, jobData).catch((err) => {
        console.error('[wa-signup] enqueue setup job failed:', (err as Error).message)
      })
    }

    return c.json(
      {
        instanceId: instance.id,
        displayPhoneNumber: data.displayPhoneNumber ?? null,
        coexistence: data.mode === 'coexistence',
      },
      201,
    )
  })
  .post('/finish/:instanceId', async (c) => {
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
    const jobData: WhatsappSetupJobData = { instanceId, organizationId }
    await jobs.send(WHATSAPP_SETUP_JOB, jobData)
    return c.json({ enqueued: true })
  })

export default app
