/**
 * Integration tests for the WhatsApp Embedded Signup HTTP surface.
 *
 * Coverage (matches Slice C acceptance):
 *   - signup-nonce-replay  → consume succeeds; replay returns 401.
 *                            Upstream-failure path also consumes the nonce.
 *                            Session-mismatch returns 401.
 *   - debug-token-validation → mock `debug_token` returning a wabaId NOT in
 *                              target_ids → exchange rejects with 401
 *                              `wabaId_mismatch`; no instance row written.
 *   - rate-limit            → 11th SUCCESSFUL exchange in <1h returns 429.
 *                              Validation failures don't consume the success bucket.
 *
 * The handler is exercised directly via `app.fetch` to skip the full Bootstrap
 * stack (and avoid pulling in better-auth). We stub `requireOrganization` by
 * pre-installing a fake session middleware on a wrapping Hono router.
 *
 * Skipped (not failed) when Docker Postgres is unreachable.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { channelInstances } from '@modules/channels/schema'
import { createChannelInstancesService, installChannelInstancesService } from '@modules/channels/service/instances'
import { createSignupNoncesService, installSignupNoncesService } from '@modules/channels/service/signup-nonces'
import { createChannelsState, installChannelsState, type JobQueue } from '@modules/channels/service/state'
import { createRateLimiter } from '@vobase/core'
import { eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'

import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../../../tests/helpers/test-db'
import whatsappSignupRoutes from './whatsapp-signup'

const TEST_ORG_ID = 'org-wa-signup-test'
const TEST_USER_ID = 'user-wa-signup-test'
const TEST_SESSION_ID_A = 'sess-wa-A'
const TEST_SESSION_ID_B = 'sess-wa-B'
const TEST_PHONE_NUMBER_ID = '111222333444555'
const TEST_WABA_ID = 'waba_test_correct'
const TEST_WRONG_WABA_ID = 'waba_test_wrong'

interface FakeContext {
  organizationId?: string
  userId?: string
  sessionId?: string
}

function buildApp(ctx: FakeContext) {
  const app = new Hono()
  // Stub for requireSession + requireOrganization. We always set a session
  // object so the downstream `requireOrganization` middleware doesn't blow
  // up on `session.session.activeOrganizationId`. The route itself checks
  // `!sessionId` after requireOrganization runs, so leaving sessionId empty
  // is the way to drive the "no session id" 401 path.
  app.use('*', async (c, next) => {
    c.set(
      'session' as never,
      {
        user: { id: ctx.userId ?? '' },
        session: {
          id: ctx.sessionId ?? '',
          activeOrganizationId: ctx.organizationId ?? null,
        },
      } as never,
    )
    if (ctx.organizationId) {
      c.set('organizationId' as never, ctx.organizationId as never)
    }
    return next()
  })
  app.route('/api/channels/whatsapp/signup', whatsappSignupRoutes)
  return app
}

interface MockMetaFetchOpts {
  /** Token to return from /oauth/access_token; null → fail. */
  accessToken: string | null
  /** wabaIds to surface in debug_token's granular_scopes.target_ids. */
  debugTargetIds: string[]
  /** app_id to return from debug_token; defaults to env META_APP_ID. */
  debugAppId?: string
  isValid?: boolean
}

function installMockMetaFetch(opts: MockMetaFetchOpts): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.includes('/oauth/access_token')) {
      if (!opts.accessToken) {
        return new Response(JSON.stringify({ error: { code: 100, message: 'invalid code' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(
        JSON.stringify({ access_token: opts.accessToken, token_type: 'bearer', expires_in: 5184000 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (url.includes('/debug_token')) {
      return new Response(
        JSON.stringify({
          data: {
            app_id: opts.debugAppId ?? process.env.META_APP_ID,
            is_valid: opts.isValid ?? true,
            expires_at: Math.floor(Date.now() / 1000) + 5184000,
            granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: opts.debugTargetIds }],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (url.includes('/subscribed_apps') || url.includes('/register')) {
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    }
    throw new Error(`mock fetch: unexpected URL ${url}`)
  }) as typeof fetch
}

const ORIGINAL_FETCH = globalThis.fetch
const ORIGINAL_ENV: Record<string, string | undefined> = {}

function setEnv(key: string, value: string | undefined) {
  if (!(key in ORIGINAL_ENV)) ORIGINAL_ENV[key] = process.env[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

function restoreEnv() {
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

let dbHandle: TestDbHandle | null = null
const stubJobs: JobQueue = {
  send: async () => 'stub-job-id',
}

beforeAll(async () => {
  try {
    await resetAndSeedDb()
    dbHandle = connectTestDb()
  } catch (err) {
    console.warn(`[whatsapp-signup.test] skipping integration suite: ${(err as Error).message}`)
    return
  }

  setEnv('META_APP_ID', '1234567890')
  setEnv('META_APP_SECRET', 'test-app-secret-do-not-use-in-prod')
  setEnv('META_APP_CONFIG_ID_CLOUD', 'cfg-cloud')
  setEnv('META_APP_CONFIG_ID_COEXISTENCE', 'cfg-coexistence')
  setEnv('META_APP_API_VERSION', 'v22.0')
  setEnv('BETTER_AUTH_SECRET', 'test-better-auth-secret-must-be-at-least-32-chars-long-pls')

  installChannelInstancesService(createChannelInstancesService({ db: dbHandle.db }))
  installSignupNoncesService(createSignupNoncesService({ db: dbHandle.db }))
  installChannelsState(
    createChannelsState({
      jobs: stubJobs,
      rateLimits: createRateLimiter(dbHandle.db),
    }),
  )
}, 60_000)

afterAll(async () => {
  globalThis.fetch = ORIGINAL_FETCH
  restoreEnv()
  if (dbHandle) await dbHandle.teardown()
})

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
})

beforeEach(async () => {
  if (!dbHandle) return
  // CASCADE because messaging.conversations + contacts.staff_channel_bindings
  // hold cross-schema FKs to channels.channel_instances.
  await dbHandle.db.execute(
    sql`TRUNCATE TABLE "channels"."channel_instances", "channels"."signup_nonces", "infra"."rate_limits" CASCADE`,
  )
})

async function startNonce(app: Hono): Promise<string> {
  const res = await app.request('/api/channels/whatsapp/signup/start', { method: 'POST' })
  expect(res.status).toBe(200)
  return ((await res.json()) as { nonce: string }).nonce
}

async function postExchange(
  app: Hono,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<Response> {
  return app.request('/api/channels/whatsapp/signup/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('POST /signup/start', () => {
  it('mints a fresh nonce + returns the operator config IDs', async () => {
    if (!dbHandle) return
    const app = buildApp({ organizationId: TEST_ORG_ID, userId: TEST_USER_ID, sessionId: TEST_SESSION_ID_A })
    const res = await app.request('/api/channels/whatsapp/signup/start', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      nonce: string
      appId: string | null
      configIdCloud: string | null
      configIdCoexistence: string | null
    }
    expect(body.nonce.length).toBeGreaterThanOrEqual(16)
    expect(body.appId).toBe('1234567890')
    expect(body.configIdCloud).toBe('cfg-cloud')
    expect(body.configIdCoexistence).toBe('cfg-coexistence')
  })

  it('401s without a session id', async () => {
    if (!dbHandle) return
    const app = buildApp({ organizationId: TEST_ORG_ID })
    const res = await app.request('/api/channels/whatsapp/signup/start', { method: 'POST' })
    expect(res.status).toBe(401)
  })
})

describe('POST /signup/exchange — happy path', () => {
  it('persists encrypted token + returns instanceId (cloud)', async () => {
    if (!dbHandle) return
    installMockMetaFetch({ accessToken: 'EAA-test-token', debugTargetIds: [TEST_WABA_ID] })
    const app = buildApp({ organizationId: TEST_ORG_ID, userId: TEST_USER_ID, sessionId: TEST_SESSION_ID_A })
    const nonce = await startNonce(app)

    const res = await postExchange(app, {
      code: 'fb-code-cloud',
      phoneNumberId: TEST_PHONE_NUMBER_ID,
      wabaId: TEST_WABA_ID,
      mode: 'cloud',
      nonce,
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { instanceId: string; coexistence: boolean }
    expect(body.coexistence).toBe(false)
    expect(body.instanceId).toBeTruthy()

    const rows = await dbHandle.db.select().from(channelInstances).where(eq(channelInstances.id, body.instanceId))
    expect(rows).toHaveLength(1)
    const cfg = rows[0]?.config as Record<string, unknown>
    expect(cfg.mode).toBe('self')
    expect(cfg.coexistence).toBe(false)
    expect(cfg.wabaId).toBe(TEST_WABA_ID)
    expect(cfg.accessTokenEnvelope).toBeDefined()
    // Plaintext access token must NEVER appear in the persisted config.
    const serialized = JSON.stringify(cfg)
    expect(serialized).not.toContain('EAA-test-token')
  })

  it('persists coexistence flag when mode=coexistence', async () => {
    if (!dbHandle) return
    installMockMetaFetch({ accessToken: 'EAA-coex', debugTargetIds: [TEST_WABA_ID] })
    const app = buildApp({ organizationId: TEST_ORG_ID, userId: TEST_USER_ID, sessionId: TEST_SESSION_ID_A })
    const nonce = await startNonce(app)
    const res = await postExchange(app, {
      code: 'fb-code-coex',
      phoneNumberId: TEST_PHONE_NUMBER_ID,
      wabaId: TEST_WABA_ID,
      mode: 'coexistence',
      nonce,
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { coexistence: boolean }
    expect(body.coexistence).toBe(true)
  })
})

describe('POST /signup/exchange — replay + session-mismatch', () => {
  it('replay with the same nonce returns 401', async () => {
    if (!dbHandle) return
    installMockMetaFetch({ accessToken: 'EAA-replay', debugTargetIds: [TEST_WABA_ID] })
    const app = buildApp({ organizationId: TEST_ORG_ID, userId: TEST_USER_ID, sessionId: TEST_SESSION_ID_A })
    const nonce = await startNonce(app)

    const first = await postExchange(app, {
      code: 'code-1',
      phoneNumberId: TEST_PHONE_NUMBER_ID,
      wabaId: TEST_WABA_ID,
      mode: 'cloud',
      nonce,
    })
    expect(first.status).toBe(201)

    const replay = await postExchange(app, {
      code: 'code-1',
      phoneNumberId: TEST_PHONE_NUMBER_ID,
      wabaId: TEST_WABA_ID,
      mode: 'cloud',
      nonce,
    })
    expect(replay.status).toBe(401)
  })

  it('upstream failure consumes the nonce (replay still 401)', async () => {
    if (!dbHandle) return
    installMockMetaFetch({ accessToken: null, debugTargetIds: [] })
    const app = buildApp({ organizationId: TEST_ORG_ID, userId: TEST_USER_ID, sessionId: TEST_SESSION_ID_A })
    const nonce = await startNonce(app)

    const first = await postExchange(app, {
      code: 'bad-code',
      phoneNumberId: TEST_PHONE_NUMBER_ID,
      wabaId: TEST_WABA_ID,
      mode: 'cloud',
      nonce,
    })
    expect(first.status).toBe(502)

    const replay = await postExchange(app, {
      code: 'bad-code',
      phoneNumberId: TEST_PHONE_NUMBER_ID,
      wabaId: TEST_WABA_ID,
      mode: 'cloud',
      nonce,
    })
    expect(replay.status).toBe(401)
  })

  it('session-mismatch returns 401', async () => {
    if (!dbHandle) return
    installMockMetaFetch({ accessToken: 'EAA-sess', debugTargetIds: [TEST_WABA_ID] })
    const appA = buildApp({ organizationId: TEST_ORG_ID, userId: TEST_USER_ID, sessionId: TEST_SESSION_ID_A })
    const nonce = await startNonce(appA)

    const appB = buildApp({ organizationId: TEST_ORG_ID, userId: TEST_USER_ID, sessionId: TEST_SESSION_ID_B })
    const res = await postExchange(appB, {
      code: 'session-mismatch',
      phoneNumberId: TEST_PHONE_NUMBER_ID,
      wabaId: TEST_WABA_ID,
      mode: 'cloud',
      nonce,
    })
    expect(res.status).toBe(401)
  })
})

describe('POST /signup/exchange — debug_token validation', () => {
  it('rejects when wabaId is not in debug_token target_ids', async () => {
    if (!dbHandle) return
    installMockMetaFetch({ accessToken: 'EAA-mismatch', debugTargetIds: [TEST_WRONG_WABA_ID] })
    const app = buildApp({ organizationId: TEST_ORG_ID, userId: TEST_USER_ID, sessionId: TEST_SESSION_ID_A })
    const nonce = await startNonce(app)

    const res = await postExchange(app, {
      code: 'mm',
      phoneNumberId: TEST_PHONE_NUMBER_ID,
      wabaId: TEST_WABA_ID,
      mode: 'cloud',
      nonce,
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('wabaId_mismatch')

    const rows = await dbHandle.db
      .select()
      .from(channelInstances)
      .where(eq(channelInstances.organizationId, TEST_ORG_ID))
    expect(rows).toHaveLength(0)
  })

  it('rejects when app_id does not match META_APP_ID', async () => {
    if (!dbHandle) return
    installMockMetaFetch({
      accessToken: 'EAA-wrongapp',
      debugTargetIds: [TEST_WABA_ID],
      debugAppId: '9999999999',
    })
    const app = buildApp({ organizationId: TEST_ORG_ID, userId: TEST_USER_ID, sessionId: TEST_SESSION_ID_A })
    const nonce = await startNonce(app)
    const res = await postExchange(app, {
      code: 'wa',
      phoneNumberId: TEST_PHONE_NUMBER_ID,
      wabaId: TEST_WABA_ID,
      mode: 'cloud',
      nonce,
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('app_id_mismatch')
  })
})

describe('POST /signup/exchange — rate limit', () => {
  it('11th SUCCESSFUL exchange in <1h returns 429', async () => {
    if (!dbHandle) return
    installMockMetaFetch({ accessToken: 'EAA-rl', debugTargetIds: [TEST_WABA_ID] })
    const app = buildApp({ organizationId: TEST_ORG_ID, userId: TEST_USER_ID, sessionId: TEST_SESSION_ID_A })

    for (let i = 0; i < 10; i++) {
      const nonce = await startNonce(app)
      const res = await postExchange(app, {
        code: `c-${i}`,
        phoneNumberId: TEST_PHONE_NUMBER_ID,
        wabaId: TEST_WABA_ID,
        mode: 'cloud',
        nonce,
      })
      expect(res.status).toBe(201)
    }

    const nonce = await startNonce(app)
    const res = await postExchange(app, {
      code: 'c-11',
      phoneNumberId: TEST_PHONE_NUMBER_ID,
      wabaId: TEST_WABA_ID,
      mode: 'cloud',
      nonce,
    })
    expect(res.status).toBe(429)
  }, 60_000)

  it('validation failures do NOT consume the success bucket', async () => {
    if (!dbHandle) return
    installMockMetaFetch({ accessToken: 'EAA-vf', debugTargetIds: [TEST_WRONG_WABA_ID] })
    const app = buildApp({ organizationId: TEST_ORG_ID, userId: TEST_USER_ID, sessionId: TEST_SESSION_ID_A })

    for (let i = 0; i < 12; i++) {
      const nonce = await startNonce(app)
      const res = await postExchange(app, {
        code: `vf-${i}`,
        phoneNumberId: TEST_PHONE_NUMBER_ID,
        wabaId: TEST_WABA_ID,
        mode: 'cloud',
        nonce,
      })
      expect(res.status).toBe(401)
    }

    installMockMetaFetch({ accessToken: 'EAA-after-vf', debugTargetIds: [TEST_WABA_ID] })
    const nonce = await startNonce(app)
    const res = await postExchange(app, {
      code: 'after-vf',
      phoneNumberId: TEST_PHONE_NUMBER_ID,
      wabaId: TEST_WABA_ID,
      mode: 'cloud',
      nonce,
    })
    expect(res.status).toBe(201)
  }, 60_000)
})
