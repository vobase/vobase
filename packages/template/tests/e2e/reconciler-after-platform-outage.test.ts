/**
 * Slice 3 — reconciler after platform outage e2e (US-026)
 *
 * Per §7.6 R9-E of the platform-tenant decoupling spec, the
 * `team:sync-staff-link` pg-boss job retries on platform 5xx with
 * exponential backoff over a ~24h horizon. This test exercises the retry
 * shape end-to-end through the reconciler's IO surface:
 *
 *   1. Platform stub is in "outage" mode — every `/staff-links` endpoint
 *      returns 503. The tenant PATCH path enqueued a reconcile (in
 *      production, via `syncStaffLinksEnqueue`); we simulate the job's
 *      first attempt by calling `syncStaffLinks` directly.
 *   2. First attempt: `syncStaffLinks` resolves with `errors: [{ phase:
 *      'list', … }]` because the GET failed. No platform writes happened
 *      (the reconciler bails before issuing upserts/deletes when the diff
 *      input is unknown).
 *   3. Flip the outage flag off. Re-run `syncStaffLinks` — simulates
 *      pg-boss firing the next retry attempt. This time the GET succeeds,
 *      the diff identifies one upsert, and the POST converges. Platform
 *      state now matches the tenant set.
 *
 * No live pg-boss — the retry timing/backoff math is exercised by the
 * unit tests around `SYNC_STAFF_LINK_RETRY_LIMIT`. What this e2e proves is
 * that the reconciler's IO seam (platform 5xx → tenant error surface →
 * subsequent success) actually converges through real `staffLinks.*`
 * helpers, not through a re-mocked happy path.
 */
/** @contract platform-tenant-v1 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'

import type { ChannelInstance } from '../../modules/channels/schema'
import type { StaffProfile } from '../../modules/team/schema'
import { syncStaffLinks } from '../../modules/team/service/staff-link-sync'

const TENANT_ID = 'tnt-us026-outage'
const HMAC = 'test-fixture-hmac-secret-us026-outage'
const BASE_URL = 'http://localhost:19028' // never bound; in-process only
const ORG_ID = 'org-us026-outage'
const CHANNEL_INSTANCE_ID = 'ch-notif-us026-outage'
const STAFF_USER_ID = 'u-us026-outage'
const STAFF_PHONE = '+6598765432'
const STAFF_WA_ID = '6598765432'

interface PlatformLink {
  staffUserId: string
  staffPhoneE164: string
  channelInstanceId: string
  linkedAt: string
}

interface PlatformState {
  links: PlatformLink[]
  /** When true, every endpoint returns 503 — simulates a platform outage. */
  outage: boolean
  /** Number of GETs the stub served (helps assert per-attempt cardinality). */
  listCalls: number
  /** Number of upsert POSTs the stub served. */
  upsertCalls: number
  /** Number of 503s served across all endpoints. */
  outageResponses: number
}

function buildPlatformStub(state: PlatformState): Hono {
  const app = new Hono()

  app.get('/api/managed-whatsapp/staff-links', (c) => {
    if (state.outage) {
      state.outageResponses += 1
      return c.json({ ok: false, code: 'service_unavailable' }, 503)
    }
    state.listCalls += 1
    const channelInstanceId = c.req.query('channelInstanceId')
    const filtered = channelInstanceId
      ? state.links.filter((l) => l.channelInstanceId === channelInstanceId)
      : state.links
    return c.json({ links: filtered })
  })

  app.post('/api/managed-whatsapp/staff-links', async (c) => {
    if (state.outage) {
      state.outageResponses += 1
      return c.json({ ok: false, code: 'service_unavailable' }, 503)
    }
    state.upsertCalls += 1
    const body = (await c.req.json()) as {
      channelInstanceId: string
      staffUserId: string
      staffPhoneE164: string
    }
    const idx = state.links.findIndex(
      (l) => l.channelInstanceId === body.channelInstanceId && l.staffPhoneE164 === body.staffPhoneE164,
    )
    if (idx >= 0) {
      state.links[idx] = { ...state.links[idx], staffUserId: body.staffUserId }
    } else {
      state.links.push({
        staffUserId: body.staffUserId,
        staffPhoneE164: body.staffPhoneE164,
        channelInstanceId: body.channelInstanceId,
        linkedAt: new Date().toISOString(),
      })
    }
    return c.json({ linked: true, staffPhoneE164: body.staffPhoneE164 })
  })

  app.delete('/api/managed-whatsapp/staff-links', async (c) => {
    if (state.outage) {
      state.outageResponses += 1
      return c.json({ ok: false, code: 'service_unavailable' }, 503)
    }
    const body = (await c.req.json()) as { staffPhoneE164: string }
    state.links = state.links.filter((l) => l.staffPhoneE164 !== body.staffPhoneE164)
    return c.json({ removed: true })
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

function makeProfile(): StaffProfile {
  return {
    userId: STAFF_USER_ID,
    organizationId: ORG_ID,
    displayName: STAFF_USER_ID,
    title: null,
    sectors: [],
    expertise: [],
    languages: [],
    capacity: 10,
    availability: 'active',
    attributes: {},
    profile: '',
    memory: '',
    lastSeenAt: null,
    phoneNumber: STAFF_PHONE,
    phoneNumberVerified: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function makeChannel(): ChannelInstance {
  return {
    id: CHANNEL_INSTANCE_ID,
    organizationId: ORG_ID,
    channel: 'whatsapp_notif',
    role: 'staff',
    displayName: 'Notification WA (outage test)',
    config: { mode: 'managed', kind: 'notification' },
    platformChannelId: 'plat-us026-outage',
    webhookSecret: null,
    status: 'active',
    setupStage: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

describe('reconciler after platform outage (US-026, slice-3)', () => {
  let restoreFetch: (() => void) | null = null
  let stubState: PlatformState

  beforeEach(() => {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('e2e test must run with NODE_ENV !== production')
    }
    stubState = { links: [], outage: true, listCalls: 0, upsertCalls: 0, outageResponses: 0 }
  })

  afterEach(() => {
    if (restoreFetch) restoreFetch()
    restoreFetch = null
  })

  it('first attempt during outage surfaces list error; retry after recovery converges', async () => {
    const stub = buildPlatformStub(stubState)
    restoreFetch = patchFetch(stub)

    const options = {
      creds: {
        platformBaseUrl: BASE_URL,
        tenantId: TENANT_ID,
        tenantHmacSecret: HMAC,
        environment: 'staging' as const,
      },
      listStaff: async () => [makeProfile()],
      findNotificationChannel: async () => makeChannel(),
    }

    // ─── Attempt 1: outage in effect ─────────────────────────────────────────
    const first = await syncStaffLinks(ORG_ID, options)

    // The reconciler couldn't compute the diff — list failed.
    if (first.kind !== 'applied') throw new Error('expected applied')
    expect(first.errors.length).toBe(1)
    expect(first.errors[0]?.phase).toBe('list')
    expect(first.applied.upserted).toBe(0)
    expect(first.applied.deleted).toBe(0)
    expect(first.toUpsert).toBe(0)
    expect(first.toDelete).toBe(0)

    // No writes hit the platform — the list bail-out short-circuits the diff.
    expect(stubState.upsertCalls).toBe(0)
    expect(stubState.links).toHaveLength(0)
    // The GET attempt did fire (and 503'd).
    expect(stubState.outageResponses).toBeGreaterThanOrEqual(1)
    expect(stubState.listCalls).toBe(0)

    // ─── Recovery: flip outage off ───────────────────────────────────────────
    stubState.outage = false

    // ─── Attempt 2: pg-boss retry fires after backoff ────────────────────────
    const second = await syncStaffLinks(ORG_ID, options)

    if (second.kind !== 'applied') throw new Error('expected applied')
    expect(second.errors).toEqual([])
    expect(second.toUpsert).toBe(1)
    expect(second.toDelete).toBe(0)
    expect(second.applied.upserted).toBe(1)

    // Platform-side state now matches the tenant set.
    expect(stubState.listCalls).toBe(1)
    expect(stubState.upsertCalls).toBe(1)
    expect(stubState.links).toHaveLength(1)
    expect(stubState.links[0]?.channelInstanceId).toBe(CHANNEL_INSTANCE_ID)
    expect(stubState.links[0]?.staffPhoneE164).toBe(STAFF_WA_ID)
    expect(stubState.links[0]?.staffUserId).toBe(STAFF_USER_ID)
  })

  it('third call after convergence is a single GET, no further writes (idempotent on retry)', async () => {
    // Guards against a retry storm: even if pg-boss fires `team:sync-staff-link`
    // multiple times after recovery (e.g. cron tick + PATCH-driven enqueue
    // racing), a converged org issues only a single GET per run.
    const stub = buildPlatformStub(stubState)
    restoreFetch = patchFetch(stub)
    stubState.outage = false

    const options = {
      creds: {
        platformBaseUrl: BASE_URL,
        tenantId: TENANT_ID,
        tenantHmacSecret: HMAC,
        environment: 'staging' as const,
      },
      listStaff: async () => [makeProfile()],
      findNotificationChannel: async () => makeChannel(),
    }

    // First run: converge.
    const first = await syncStaffLinks(ORG_ID, options)
    if (first.kind !== 'applied') throw new Error('expected applied')
    expect(first.applied.upserted).toBe(1)
    expect(stubState.upsertCalls).toBe(1)

    // Second run on converged state: no writes, just the listing GET.
    const second = await syncStaffLinks(ORG_ID, options)
    if (second.kind !== 'applied') throw new Error('expected applied')
    expect(second.errors).toEqual([])
    expect(second.toUpsert).toBe(0)
    expect(second.toDelete).toBe(0)
    expect(second.applied).toEqual({ upserted: 0, deleted: 0 })
    expect(stubState.listCalls).toBe(2) // one per run
    expect(stubState.upsertCalls).toBe(1) // unchanged from first run
  })
})
