/**
 * Integration test for the staff-link reconciler.
 *
 * Stands up a tiny in-process Hono platform stub that implements the three
 * `/api/managed-whatsapp/staff-links` verbs the reconciler calls (`GET`,
 * `POST`, `DELETE`). The default `staffLinks.*` handshake helpers are used
 * unchanged — `globalThis.fetch` is patched to route requests to the stub
 * via `app.fetch`. This exercises the full sign-request → fetch →
 * verify-on-platform → respond → parse-on-tenant loop without any real
 * network.
 *
 * Mirrors the helper shape from `tests/e2e/slice-1-handshake-roundtrip.test.ts`
 * (US-008) so the two integration suites have a single recognizable pattern.
 *
 * NOTE: The tenant-side reconciler still issues *signed* requests via the
 * real `staffLinks` helpers; the stub doesn't actually verify HMAC because
 * the handshake-roundtrip e2e already covers that path. This file's
 * contribution is the end-to-end shape of the reconciler driving the platform.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { NotificationSettings } from '@modules/channels/service/notification-settings'
import { Hono } from 'hono'

import type { StaffProfile } from '../schema'
import { syncStaffLinks } from './staff-link-sync'

const ORG_ID = 'org-int-001'
// syncStaffLinks derives the channel id from `notificationChannelInstanceId(orgId, env)`
// — see staff-link-sync.ts. Stays in lockstep with the deterministic `mgd-<orgId>-<env>-notif`.
const CHANNEL_INSTANCE_ID = `mgd-${ORG_ID}-staging-notif`
const BASE_URL = 'http://localhost:9998' // never bound — in-process via globalThis.fetch patch
const TENANT_ID = 'tnt-int'
const HMAC = 'integration-test-hmac'

interface PlatformLink {
  staffUserId: string
  staffPhoneE164: string
  channelInstanceId: string
  linkedAt: string
}

function buildPlatformStub(seed: PlatformLink[]): { app: Hono; state: { links: PlatformLink[] } } {
  const state = { links: [...seed] }
  const app = new Hono()

  app.get('/api/managed-whatsapp/staff-links', (c) => {
    const channelInstanceId = c.req.query('channelInstanceId')
    const filtered = channelInstanceId
      ? state.links.filter((l) => l.channelInstanceId === channelInstanceId)
      : state.links
    return c.json({ links: filtered })
  })

  app.post('/api/managed-whatsapp/staff-links', async (c) => {
    const body = (await c.req.json()) as {
      channelInstanceId: string
      staffUserId: string
      staffPhoneE164: string
    }
    // Upsert on (channelInstanceId, staffPhoneE164).
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
    const body = (await c.req.json()) as { staffPhoneE164: string }
    const before = state.links.length
    state.links = state.links.filter((l) => l.staffPhoneE164 !== body.staffPhoneE164)
    return c.json({ removed: state.links.length < before })
  })

  return { app, state }
}

/** Patch `globalThis.fetch` to route `BASE_URL` requests to the in-process Hono app. */
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

function makeProfile(userId: string, phone: string | null): StaffProfile {
  return {
    userId,
    organizationId: ORG_ID,
    displayName: userId,
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
    phoneNumber: phone,
    phoneNumberVerified: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function makeSettings(): NotificationSettings {
  return {
    organizationId: ORG_ID,
    notificationEndpointId: 'ep-notif-int',
    magicLinkEndpointId: 'ep-ml-int',
    platformHmacSecretEnvelope: 'envelope-int',
    platformBaseUrl: BASE_URL,
    displayPhoneNumber: '+15550101',
    phoneNumberId: 'pn-int',
    wabaId: 'waba-int',
    metaTemplateApprovals: {},
    lastVerifyStatus: null,
    lastVerifiedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

describe('syncStaffLinks — in-process platform stub (integration)', () => {
  let restoreFetch: (() => void) | null = null

  beforeEach(() => {
    // Allow localhost URLs through the platform-base-URL allowlist in non-prod.
    if (process.env.NODE_ENV === 'production') {
      throw new Error('integration test must run with NODE_ENV !== production')
    }
  })

  afterEach(() => {
    if (restoreFetch) restoreFetch()
    restoreFetch = null
  })

  it('converges: tenant has phone, platform empty → POST staff-link → state matches', async () => {
    const { app, state } = buildPlatformStub([])
    restoreFetch = patchFetch(app)

    const result = await syncStaffLinks(ORG_ID, {
      creds: {
        platformBaseUrl: BASE_URL,
        tenantId: TENANT_ID,
        tenantHmacSecret: HMAC,
        environment: 'staging',
      },
      listStaff: async () => [makeProfile('u-1', '+6591111111')],
      getNotificationSettings: async () => makeSettings(),
    })

    if (result.kind !== 'applied') throw new Error('expected applied')
    expect(result.applied.upserted).toBe(1)
    expect(result.applied.deleted).toBe(0)
    expect(state.links).toHaveLength(1)
    expect(state.links[0]?.staffUserId).toBe('u-1')
    // Platform stores the wa_id form (digits-only); handshake helpers normalize.
    expect(state.links[0]?.staffPhoneE164).toBe('6591111111')
  })

  it('converges: tenant empty, platform has stale → DELETE staff-link → state matches', async () => {
    const { app, state } = buildPlatformStub([
      {
        staffUserId: 'u-old',
        staffPhoneE164: '6599999999',
        channelInstanceId: CHANNEL_INSTANCE_ID,
        linkedAt: new Date().toISOString(),
      },
    ])
    restoreFetch = patchFetch(app)

    const result = await syncStaffLinks(ORG_ID, {
      creds: {
        platformBaseUrl: BASE_URL,
        tenantId: TENANT_ID,
        tenantHmacSecret: HMAC,
        environment: 'staging',
      },
      listStaff: async () => [],
      getNotificationSettings: async () => makeSettings(),
    })

    if (result.kind !== 'applied') throw new Error('expected applied')
    expect(result.applied.deleted).toBe(1)
    expect(result.applied.upserted).toBe(0)
    expect(state.links).toHaveLength(0)
  })

  it('re-running on converged state is a single GET, no writes', async () => {
    const { app, state } = buildPlatformStub([
      {
        staffUserId: 'u-1',
        staffPhoneE164: '6591111111',
        channelInstanceId: CHANNEL_INSTANCE_ID,
        linkedAt: new Date().toISOString(),
      },
    ])
    restoreFetch = patchFetch(app)

    const result = await syncStaffLinks(ORG_ID, {
      creds: {
        platformBaseUrl: BASE_URL,
        tenantId: TENANT_ID,
        tenantHmacSecret: HMAC,
        environment: 'staging',
      },
      listStaff: async () => [makeProfile('u-1', '+6591111111')],
      getNotificationSettings: async () => makeSettings(),
    })

    if (result.kind !== 'applied') throw new Error('expected applied')
    expect(result.applied.upserted).toBe(0)
    expect(result.applied.deleted).toBe(0)
    expect(result.errors).toEqual([])
    expect(state.links).toHaveLength(1)
  })
})
