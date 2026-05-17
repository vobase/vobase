/**
 * Slice 3 — staff-in-two-orgs disambiguation e2e (US-026)
 *
 * Two organizations on the same tenant template can have staff members
 * registered with identical WhatsApp numbers. Per §4.3 of the
 * platform-tenant decoupling spec, the platform stores staff-links keyed on
 * `(channel_instance_id, staff_phone_e164)`, so two distinct rows result —
 * one per org's notification-tier channel. Inbound dispatch then
 * disambiguates by the channel instance id the webhook lands on (which
 * carries `organization_id`), not by phone alone.
 *
 * This test exercises the round-trip via the real `staffLinks.upsert`
 * helper against an in-process Hono platform stub:
 *
 *   1. Run `syncStaffLinks` for orgA → platform records one row keyed on
 *      orgA's notification channel.
 *   2. Run `syncStaffLinks` for orgB (same `+6591234567` phone, different
 *      staff user) → platform records a SECOND distinct row keyed on
 *      orgB's notification channel.
 *   3. The same wa_id appears in both rows, but the per-channel key
 *      disambiguates them — `find(row => row.channelInstanceId === X)`
 *      returns the orgA staff for orgA's channel and the orgB staff for
 *      orgB's channel.
 *
 * No live network, no live DB. Platform is an in-process Hono stub. Tenant
 * side uses the real `syncStaffLinks` + `staffLinks.*` helpers; the only
 * stubs are the `listStaff` and `findNotificationChannel` deps, which the
 * reconciler already exposes for the unit-test seam.
 */
/** @contract platform-tenant-v1 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'

import type { ChannelInstance } from '../../modules/channels/schema'
import type { StaffProfile } from '../../modules/team/schema'
import { syncStaffLinks } from '../../modules/team/service/staff-link-sync'

const TENANT_ID = 'tnt-us026'
const HMAC = 'test-fixture-hmac-secret-us026-two-orgs'
const BASE_URL = 'http://localhost:19026' // never bound; in-process only
const SHARED_PHONE = '+6591234567'
const SHARED_WA_ID = '6591234567'

const ORG_A = 'org-us026-a'
const ORG_B = 'org-us026-b'
const ORG_A_CHANNEL_ID = 'ch-notif-us026-a'
const ORG_B_CHANNEL_ID = 'ch-notif-us026-b'
const ORG_A_STAFF_USER_ID = 'u-orgA-staff'
const ORG_B_STAFF_USER_ID = 'u-orgB-staff'

interface PlatformLink {
  staffUserId: string
  staffPhoneE164: string
  channelInstanceId: string
  linkedAt: string
}

interface PlatformState {
  links: PlatformLink[]
  upsertCalls: Array<{ channelInstanceId: string; staffUserId: string; staffPhoneE164: string }>
}

function buildPlatformStub(): { app: Hono; state: PlatformState } {
  const state: PlatformState = { links: [], upsertCalls: [] }
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
    state.upsertCalls.push({
      channelInstanceId: body.channelInstanceId,
      staffUserId: body.staffUserId,
      staffPhoneE164: body.staffPhoneE164,
    })
    // Upsert keyed on `(channelInstanceId, staffPhoneE164)` — the platform
    // contract that lets two orgs share a phone.
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

function makeProfile(orgId: string, userId: string, phone: string): StaffProfile {
  return {
    userId,
    organizationId: orgId,
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

function makeChannel(orgId: string, channelInstanceId: string): ChannelInstance {
  return {
    id: channelInstanceId,
    organizationId: orgId,
    channel: 'whatsapp_notif',
    role: 'staff',
    displayName: `Notification WA (${orgId})`,
    config: { mode: 'managed', kind: 'notification' },
    platformChannelId: `plat-${channelInstanceId}`,
    webhookSecret: null,
    status: 'active',
    setupStage: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

describe('staff-in-two-orgs disambiguation (US-026, slice-3)', () => {
  let restoreFetch: (() => void) | null = null

  beforeEach(() => {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('e2e test must run with NODE_ENV !== production')
    }
  })

  afterEach(() => {
    if (restoreFetch) restoreFetch()
    restoreFetch = null
  })

  it('reconciling both orgs registers two distinct platform staff-links keyed on channelInstanceId', async () => {
    const { app, state } = buildPlatformStub()
    restoreFetch = patchFetch(app)

    // Reconcile orgA — same phone, different channel.
    const resultA = await syncStaffLinks(ORG_A, {
      creds: {
        platformBaseUrl: BASE_URL,
        tenantId: TENANT_ID,
        tenantHmacSecret: HMAC,
        environment: 'staging',
      },
      listStaff: async (orgId) => {
        expect(orgId).toBe(ORG_A)
        return [makeProfile(ORG_A, ORG_A_STAFF_USER_ID, SHARED_PHONE)]
      },
      findNotificationChannel: async (orgId) => {
        expect(orgId).toBe(ORG_A)
        return makeChannel(ORG_A, ORG_A_CHANNEL_ID)
      },
    })
    if (resultA.kind !== 'applied') throw new Error('expected applied')
    expect(resultA.applied.upserted).toBe(1)
    expect(resultA.applied.deleted).toBe(0)
    expect(resultA.errors).toEqual([])

    // Reconcile orgB — same phone, different staff user, different channel.
    const resultB = await syncStaffLinks(ORG_B, {
      creds: {
        platformBaseUrl: BASE_URL,
        tenantId: TENANT_ID,
        tenantHmacSecret: HMAC,
        environment: 'staging',
      },
      listStaff: async (orgId) => {
        expect(orgId).toBe(ORG_B)
        return [makeProfile(ORG_B, ORG_B_STAFF_USER_ID, SHARED_PHONE)]
      },
      findNotificationChannel: async (orgId) => {
        expect(orgId).toBe(ORG_B)
        return makeChannel(ORG_B, ORG_B_CHANNEL_ID)
      },
    })
    if (resultB.kind !== 'applied') throw new Error('expected applied')
    expect(resultB.applied.upserted).toBe(1)
    expect(resultB.applied.deleted).toBe(0)
    expect(resultB.errors).toEqual([])

    // Platform received exactly two distinct upserts — one per
    // channelInstanceId — both carrying the SAME wa_id.
    expect(state.upsertCalls).toHaveLength(2)
    const callA = state.upsertCalls.find((c) => c.channelInstanceId === ORG_A_CHANNEL_ID)
    const callB = state.upsertCalls.find((c) => c.channelInstanceId === ORG_B_CHANNEL_ID)
    expect(callA).toBeDefined()
    expect(callB).toBeDefined()
    expect(callA?.staffUserId).toBe(ORG_A_STAFF_USER_ID)
    expect(callB?.staffUserId).toBe(ORG_B_STAFF_USER_ID)
    expect(callA?.staffPhoneE164).toBe(SHARED_WA_ID)
    expect(callB?.staffPhoneE164).toBe(SHARED_WA_ID)

    // Platform now carries two rows. Both share the same wa_id; the channel
    // instance id is the only field that distinguishes them.
    expect(state.links).toHaveLength(2)
    const rowsForPhone = state.links.filter((l) => l.staffPhoneE164 === SHARED_WA_ID)
    expect(rowsForPhone).toHaveLength(2)
    const channelIds = rowsForPhone.map((l) => l.channelInstanceId).sort()
    expect(channelIds).toEqual([ORG_A_CHANNEL_ID, ORG_B_CHANNEL_ID].sort())
  })

  it('inbound disambiguation: looking up by (channelInstanceId, sender_phone) returns the correct org-bound staff', async () => {
    // Same fixture as the previous test, but written from the inbound's
    // perspective: the staff WA reply lands on `/inbound/:channelInstanceId`,
    // so the resolver uses `channelInstanceId` (which carries `organizationId`)
    // to pick the right org-side staff row.
    const { app, state } = buildPlatformStub()
    restoreFetch = patchFetch(app)

    // Seed: reconcile both orgs.
    await syncStaffLinks(ORG_A, {
      creds: {
        platformBaseUrl: BASE_URL,
        tenantId: TENANT_ID,
        tenantHmacSecret: HMAC,
        environment: 'staging',
      },
      listStaff: async () => [makeProfile(ORG_A, ORG_A_STAFF_USER_ID, SHARED_PHONE)],
      findNotificationChannel: async () => makeChannel(ORG_A, ORG_A_CHANNEL_ID),
    })
    await syncStaffLinks(ORG_B, {
      creds: {
        platformBaseUrl: BASE_URL,
        tenantId: TENANT_ID,
        tenantHmacSecret: HMAC,
        environment: 'staging',
      },
      listStaff: async () => [makeProfile(ORG_B, ORG_B_STAFF_USER_ID, SHARED_PHONE)],
      findNotificationChannel: async () => makeChannel(ORG_B, ORG_B_CHANNEL_ID),
    })

    // Inbound from `+6591234567` lands on orgA's channel webhook — resolver
    // would look up `(channelInstanceId=ORG_A_CHANNEL_ID, staffPhoneE164=...)`
    // and find the orgA staff row.
    const matchA = state.links.find(
      (l) => l.channelInstanceId === ORG_A_CHANNEL_ID && l.staffPhoneE164 === SHARED_WA_ID,
    )
    expect(matchA?.staffUserId).toBe(ORG_A_STAFF_USER_ID)

    // Inbound from same phone lands on orgB's channel webhook — resolver
    // returns the orgB staff row, NOT orgA's.
    const matchB = state.links.find(
      (l) => l.channelInstanceId === ORG_B_CHANNEL_ID && l.staffPhoneE164 === SHARED_WA_ID,
    )
    expect(matchB?.staffUserId).toBe(ORG_B_STAFF_USER_ID)

    // Cross-checks: lookup keyed on a channelInstanceId that does NOT match
    // the inbound's channel must NOT return the other org's row.
    expect(matchA?.staffUserId).not.toBe(ORG_B_STAFF_USER_ID)
    expect(matchB?.staffUserId).not.toBe(ORG_A_STAFF_USER_ID)
  })
})
