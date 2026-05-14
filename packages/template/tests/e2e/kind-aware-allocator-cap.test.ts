/**
 * Slice 3 — kind-aware allocator cap e2e (US-026)
 *
 * The notification kind is capped at 1 active claim per `(tenant, environment)`
 * pair (per §7.4 of the platform-tenant decoupling spec). The platform enforces
 * the cap server-side and returns a structured error on the second claim attempt;
 * the tenant surfaces that as `PlatformHandshakeError` with the platform's
 * `code` field preserved.
 *
 * The sandbox kind has no such cap (pool-allocated). This test verifies both:
 *
 *   1. `claim('notification', …)` once → succeeds with full allocation.
 *   2. `claim('notification', …)` a SECOND time from the same tenant+env →
 *      platform returns 409 + `{ code: 'notification_cap_exceeded' }`; tenant
 *      throws `PlatformHandshakeError` whose `.status` is 409 and whose
 *      `.code` is `notification_cap_exceeded`.
 *   3. In between, `claim('sandbox', …)` still succeeds — the cap is
 *      per-kind, not global.
 *
 * No live network. Platform is an in-process Hono stub that signs/verifies
 * via the v2 2-key HMAC contract (we don't re-verify HMAC here because
 * Slice-1's handshake-roundtrip test already covers it; this test focuses
 * on the cap policy).
 */
/** @contract platform-tenant-v1 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'

import { claim, PlatformHandshakeError } from '../../modules/integrations/service/handshake'

const TENANT_ID = 'tnt-us026-cap'
const HMAC = 'test-fixture-hmac-secret-us026-cap'
const BASE_URL = 'http://localhost:19027' // never bound; in-process only
const ENV: 'staging' = 'staging'

const NOTIFICATION_CLAIM_PATH = '/api/managed-whatsapp/notification/claim'
const SANDBOX_CLAIM_PATH = '/api/managed-whatsapp/sandbox/create'

interface StubState {
  notificationClaimCalls: number
  sandboxClaimCalls: number
  /** Whether the platform already has a notification claim for this tenant+env. */
  notificationClaimActive: boolean
}

function buildAllocation(channelInstanceId: string): Record<string, unknown> {
  return {
    platformChannelId: `pcid-${channelInstanceId}`,
    wabaId: 'waba-us026',
    phoneNumberId: `pnid-${channelInstanceId}`,
    displayPhoneNumber: '+6500000000',
    routineSecret: 'rs-fresh-us026',
    rotationKey: 'rk-fresh-us026',
    keyVersion: 1,
    routineSecretPrevious: null,
    rotationKeyPrevious: null,
    previousValidUntil: null,
  }
}

function buildPlatformStub(state: StubState): Hono {
  const app = new Hono()

  // Notification kind — cap of 1 per tenant. A second claim before the
  // first is released returns 409 + structured error.
  //
  // v3: request body is now an empty `{}` — the platform keys claims solely
  // on `(tenant_slug, kind)`. Tests use a per-call counter to fabricate a
  // distinct `platformChannelId` rather than echoing a `channelInstanceId`
  // from the body.
  app.post(NOTIFICATION_CLAIM_PATH, async (c) => {
    state.notificationClaimCalls += 1
    if (state.notificationClaimActive) {
      return c.json(
        {
          ok: false,
          code: 'notification_cap_exceeded',
          error: `tenant ${TENANT_ID} already has a notification claim; release it first`,
        },
        409,
      )
    }
    state.notificationClaimActive = true
    return c.json(buildAllocation(`notif-${state.notificationClaimCalls}`))
  })

  // Sandbox kind — pool-allocated, no per-tenant cap. Always succeeds.
  app.post(SANDBOX_CLAIM_PATH, async (c) => {
    state.sandboxClaimCalls += 1
    return c.json(buildAllocation(`sandbox-${state.sandboxClaimCalls}`))
  })

  return app
}

function patchFetch(app: Hono): () => void {
  const original = globalThis.fetch
  type FetchFn = typeof globalThis.fetch
  const wrapper: FetchFn = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.startsWith(BASE_URL)) {
      const req = new Request(url, init)
      return Promise.resolve(app.fetch(req))
    }
    return original(input, init)
  }) as FetchFn
  globalThis.fetch = Object.assign(wrapper, original) as FetchFn
  return () => {
    globalThis.fetch = original
  }
}

describe('kind-aware allocator cap (US-026, slice-3)', () => {
  let restoreFetch: (() => void) | null = null
  let stubState: StubState

  beforeEach(() => {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('e2e test must run with NODE_ENV !== production')
    }
    stubState = { notificationClaimCalls: 0, sandboxClaimCalls: 0, notificationClaimActive: false }
  })

  afterEach(() => {
    if (restoreFetch) restoreFetch()
    restoreFetch = null
  })

  it('first notification claim succeeds; second hits the per-(tenant,env) cap', async () => {
    const stub = buildPlatformStub(stubState)
    restoreFetch = patchFetch(stub)

    // First claim — succeeds.
    const first = await claim('notification', {
      platformBaseUrl: BASE_URL,
      tenantId: TENANT_ID,
      tenantHmacSecret: HMAC,
      environment: ENV,
      channelInstanceId: 'ch-notif-us026-cap-1',
      kind: 'notification',
    })
    // v3: the stub fabricates platformChannelId per-call (body is now empty),
    // so the assertion key on the call counter rather than the request body.
    expect(first.platformChannelId).toBe('pcid-notif-1')
    expect(stubState.notificationClaimCalls).toBe(1)
    expect(stubState.notificationClaimActive).toBe(true)

    // Second claim — rejects with structured cap error.
    let caught: unknown
    try {
      await claim('notification', {
        platformBaseUrl: BASE_URL,
        tenantId: TENANT_ID,
        tenantHmacSecret: HMAC,
        environment: ENV,
        channelInstanceId: 'ch-notif-us026-cap-2',
        kind: 'notification',
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(PlatformHandshakeError)
    const handshakeErr = caught as PlatformHandshakeError
    expect(handshakeErr.status).toBe(409)
    expect(handshakeErr.code).toBe('notification_cap_exceeded')
    expect(handshakeErr.message).toContain('notification claim failed')

    // Platform saw both attempts.
    expect(stubState.notificationClaimCalls).toBe(2)
  })

  it('sandbox claim continues to work between two notification claim attempts (cap is per-kind)', async () => {
    const stub = buildPlatformStub(stubState)
    restoreFetch = patchFetch(stub)

    // Notification claim #1 — succeeds, flips the cap to "active".
    await claim('notification', {
      platformBaseUrl: BASE_URL,
      tenantId: TENANT_ID,
      tenantHmacSecret: HMAC,
      environment: ENV,
      channelInstanceId: 'ch-notif-us026-mixed',
      kind: 'notification',
    })
    expect(stubState.notificationClaimActive).toBe(true)

    // Sandbox claim in the middle — different kind, different path, no cap.
    const sandboxAlloc = await claim('sandbox', {
      platformBaseUrl: BASE_URL,
      tenantId: TENANT_ID,
      tenantHmacSecret: HMAC,
      environment: ENV,
      channelInstanceId: 'ch-sandbox-us026-mixed',
      kind: 'sandbox',
    })
    expect(sandboxAlloc.platformChannelId).toBe('pcid-sandbox-1')
    expect(stubState.sandboxClaimCalls).toBe(1)

    // Notification claim #2 — still rejected by the cap.
    let caught: unknown
    try {
      await claim('notification', {
        platformBaseUrl: BASE_URL,
        tenantId: TENANT_ID,
        tenantHmacSecret: HMAC,
        environment: ENV,
        channelInstanceId: 'ch-notif-us026-mixed-2',
        kind: 'notification',
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(PlatformHandshakeError)
    expect((caught as PlatformHandshakeError).code).toBe('notification_cap_exceeded')

    // Each path counted independently.
    expect(stubState.notificationClaimCalls).toBe(2)
    expect(stubState.sandboxClaimCalls).toBe(1)
  })
})
