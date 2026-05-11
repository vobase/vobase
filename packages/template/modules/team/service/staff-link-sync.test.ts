/**
 * Unit tests for the staff-link reconciler. Exercises the diff/apply logic
 * with fully stubbed deps — no DB, no platform, no network. Per-row error
 * paths and `dryRun` are covered alongside the four canonical diff shapes
 * (no-op, upsert-only, delete-only, mixed).
 */

import { describe, expect, it } from 'bun:test'

import type { ChannelInstance } from '../../channels/schema'
import type { StaffProfile } from '../schema'
import { type SyncStaffLinksDeps, syncStaffLinks } from './staff-link-sync'

const ORG_ID = 'org-test-001'
const CHANNEL_INSTANCE_ID = 'ch-notif-001'
const PLATFORM_URL = 'https://platform.test.local'
const TENANT_ID = 'tenant-test'
const HMAC = 'hmac-secret-test'

function makeProfile(overrides: Partial<StaffProfile> = {}): StaffProfile {
  return {
    userId: overrides.userId ?? 'u-1',
    organizationId: ORG_ID,
    displayName: 'Test',
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
    whatsappPhoneE164: overrides.whatsappPhoneE164 ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function makeChannel(): ChannelInstance {
  return {
    id: CHANNEL_INSTANCE_ID,
    organizationId: ORG_ID,
    channel: 'whatsapp_notif',
    role: 'staff',
    displayName: 'Notification WA',
    config: { mode: 'managed', kind: 'notification' },
    platformChannelId: 'plat-ch-1',
    webhookSecret: null,
    status: 'active',
    setupStage: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

interface StubCalls {
  upsert: Array<{ staffUserId: string; staffPhoneE164: string }>
  delete: Array<{ staffPhoneE164: string }>
  listCalls: number
}

function buildDeps(opts: {
  staff: StaffProfile[]
  platform: Array<{ staffUserId: string; staffPhoneE164: string }>
  channel?: ChannelInstance | null
  listFails?: boolean
  upsertFailsFor?: string
  deleteFailsFor?: string
}): { deps: SyncStaffLinksDeps; calls: StubCalls } {
  const calls: StubCalls = { upsert: [], delete: [], listCalls: 0 }
  const deps: SyncStaffLinksDeps = {
    listStaff: async (_orgId) => opts.staff,
    findNotificationChannel: async (_orgId) => (opts.channel === undefined ? makeChannel() : opts.channel),
    staffLinksApi: {
      list: async () => {
        calls.listCalls += 1
        if (opts.listFails) throw new Error('platform list 503')
        return opts.platform.map((p) => ({
          staffUserId: p.staffUserId,
          staffPhoneE164: p.staffPhoneE164,
          channelInstanceId: CHANNEL_INSTANCE_ID,
          linkedAt: new Date().toISOString(),
        }))
      },
      upsert: async (input) => {
        if (opts.upsertFailsFor === input.staffPhoneE164) throw new Error('upsert 502')
        calls.upsert.push({ staffUserId: input.staffUserId, staffPhoneE164: input.staffPhoneE164 })
        return { linked: true, staffPhoneE164: input.staffPhoneE164 }
      },
      delete: async (input) => {
        if (opts.deleteFailsFor === input.staffPhoneE164) throw new Error('delete 504')
        calls.delete.push({ staffPhoneE164: input.staffPhoneE164 })
        return { removed: true }
      },
    },
  }
  return { deps, calls }
}

const baseCtx = {
  orgId: ORG_ID,
  platformBaseUrl: PLATFORM_URL,
  tenantId: TENANT_ID,
  tenantHmacSecret: HMAC,
  environment: 'staging' as const,
}

describe('syncStaffLinks() — diff/apply', () => {
  it('no-op when tenant set equals platform set', async () => {
    const { deps, calls } = buildDeps({
      staff: [makeProfile({ userId: 'u-1', whatsappPhoneE164: '+6591111111' })],
      platform: [{ staffUserId: 'u-1', staffPhoneE164: '6591111111' }],
    })
    const result = await syncStaffLinks(baseCtx, {}, deps)
    expect(result.toUpsert).toBe(0)
    expect(result.toDelete).toBe(0)
    expect(result.applied.upserted).toBe(0)
    expect(result.applied.deleted).toBe(0)
    expect(calls.upsert.length).toBe(0)
    expect(calls.delete.length).toBe(0)
    expect(calls.listCalls).toBe(1)
    expect(result.errors).toEqual([])
  })

  it('upsert-needed: tenant has 1 phone not on platform', async () => {
    const { deps, calls } = buildDeps({
      staff: [makeProfile({ userId: 'u-1', whatsappPhoneE164: '+6591111111' })],
      platform: [],
    })
    const result = await syncStaffLinks(baseCtx, {}, deps)
    expect(result.toUpsert).toBe(1)
    expect(result.toDelete).toBe(0)
    expect(result.applied.upserted).toBe(1)
    expect(calls.upsert).toEqual([{ staffUserId: 'u-1', staffPhoneE164: '+6591111111' }])
    expect(calls.delete.length).toBe(0)
  })

  it('delete-needed: platform has 1 link not in tenant set', async () => {
    const { deps, calls } = buildDeps({
      staff: [],
      platform: [{ staffUserId: 'u-orphan', staffPhoneE164: '6599999999' }],
    })
    const result = await syncStaffLinks(baseCtx, {}, deps)
    expect(result.toUpsert).toBe(0)
    expect(result.toDelete).toBe(1)
    expect(result.applied.deleted).toBe(1)
    expect(calls.delete).toEqual([{ staffPhoneE164: '6599999999' }])
    expect(calls.upsert.length).toBe(0)
  })

  it('mixed: one upsert + one delete', async () => {
    const { deps, calls } = buildDeps({
      staff: [makeProfile({ userId: 'u-new', whatsappPhoneE164: '+6512345678' })],
      platform: [{ staffUserId: 'u-gone', staffPhoneE164: '6587654321' }],
    })
    const result = await syncStaffLinks(baseCtx, {}, deps)
    expect(result.toUpsert).toBe(1)
    expect(result.toDelete).toBe(1)
    expect(result.applied).toEqual({ upserted: 1, deleted: 1 })
    expect(calls.upsert).toEqual([{ staffUserId: 'u-new', staffPhoneE164: '+6512345678' }])
    expect(calls.delete).toEqual([{ staffPhoneE164: '6587654321' }])
  })

  it('rebind: same phone, different staffUserId → upsert', async () => {
    // Out-of-order PATCH safety: when phone bookkeeping swaps owners on the
    // same number, the reconciler issues an upsert to re-bind the platform
    // row's `staffUserId`.
    const { deps, calls } = buildDeps({
      staff: [makeProfile({ userId: 'u-new-owner', whatsappPhoneE164: '+6511111111' })],
      platform: [{ staffUserId: 'u-old-owner', staffPhoneE164: '6511111111' }],
    })
    const result = await syncStaffLinks(baseCtx, {}, deps)
    expect(result.toUpsert).toBe(1)
    expect(result.toDelete).toBe(0)
    expect(calls.upsert).toEqual([{ staffUserId: 'u-new-owner', staffPhoneE164: '+6511111111' }])
  })

  it('dryRun: computes diff without writing', async () => {
    const { deps, calls } = buildDeps({
      staff: [makeProfile({ userId: 'u-1', whatsappPhoneE164: '+6591111111' })],
      platform: [{ staffUserId: 'u-2', staffPhoneE164: '6592222222' }],
    })
    const result = await syncStaffLinks(baseCtx, { dryRun: true }, deps)
    expect(result.toUpsert).toBe(1)
    expect(result.toDelete).toBe(1)
    expect(result.applied).toEqual({ upserted: 0, deleted: 0 })
    expect(calls.upsert.length).toBe(0)
    expect(calls.delete.length).toBe(0)
  })

  it('per-row upsert error: continues, accumulates in errors', async () => {
    // Two upserts, the first one errors. The reconciler must still attempt
    // the second so partial progress lands.
    const { deps, calls } = buildDeps({
      staff: [
        makeProfile({ userId: 'u-1', whatsappPhoneE164: '+6511111111' }),
        makeProfile({ userId: 'u-2', whatsappPhoneE164: '+6522222222' }),
      ],
      platform: [],
      upsertFailsFor: '+6511111111',
    })
    const result = await syncStaffLinks(baseCtx, {}, deps)
    expect(result.toUpsert).toBe(2)
    expect(result.applied.upserted).toBe(1)
    expect(result.errors.length).toBe(1)
    expect(result.errors[0]?.phase).toBe('upsert')
    expect(result.errors[0]?.staffPhoneE164).toBe('+6511111111')
    expect(calls.upsert).toEqual([{ staffUserId: 'u-2', staffPhoneE164: '+6522222222' }])
  })

  it('per-row delete error: continues, accumulates in errors', async () => {
    const { deps, calls } = buildDeps({
      staff: [],
      platform: [
        { staffUserId: 'u-1', staffPhoneE164: '6511111111' },
        { staffUserId: 'u-2', staffPhoneE164: '6522222222' },
      ],
      deleteFailsFor: '6511111111',
    })
    const result = await syncStaffLinks(baseCtx, {}, deps)
    expect(result.toDelete).toBe(2)
    expect(result.applied.deleted).toBe(1)
    expect(result.errors.length).toBe(1)
    expect(result.errors[0]?.phase).toBe('delete')
    expect(calls.delete).toEqual([{ staffPhoneE164: '6522222222' }])
  })

  it('platform list failure aborts with single error', async () => {
    const { deps, calls } = buildDeps({
      staff: [makeProfile({ userId: 'u-1', whatsappPhoneE164: '+6591111111' })],
      platform: [],
      listFails: true,
    })
    const result = await syncStaffLinks(baseCtx, {}, deps)
    expect(result.errors.length).toBe(1)
    expect(result.errors[0]?.phase).toBe('list')
    expect(calls.upsert.length).toBe(0)
    expect(calls.delete.length).toBe(0)
  })

  it('no notification channel → skipped, no platform calls', async () => {
    const { deps, calls } = buildDeps({
      staff: [makeProfile({ userId: 'u-1', whatsappPhoneE164: '+6591111111' })],
      platform: [],
      channel: null,
    })
    const result = await syncStaffLinks(baseCtx, {}, deps)
    expect(result.skipped).toBe('no_notification_channel')
    expect(calls.listCalls).toBe(0)
  })

  it('platform creds missing → skipped, no platform calls', async () => {
    const { deps, calls } = buildDeps({
      staff: [makeProfile({ userId: 'u-1', whatsappPhoneE164: '+6591111111' })],
      platform: [],
    })
    const prevUrl = process.env.VITE_PLATFORM_URL
    const prevTenant = process.env.VITE_PLATFORM_TENANT_SLUG
    const prevHmac = process.env.PLATFORM_HMAC_SECRET
    delete process.env.VITE_PLATFORM_URL
    delete process.env.VITE_PLATFORM_TENANT_SLUG
    delete process.env.PLATFORM_HMAC_SECRET
    try {
      const result = await syncStaffLinks(
        { orgId: ORG_ID }, // no override creds → falls through to env
        {},
        deps,
      )
      expect(result.skipped).toBe('platform_not_configured')
      expect(calls.listCalls).toBe(0)
    } finally {
      if (prevUrl !== undefined) process.env.VITE_PLATFORM_URL = prevUrl
      if (prevTenant !== undefined) process.env.VITE_PLATFORM_TENANT_SLUG = prevTenant
      if (prevHmac !== undefined) process.env.PLATFORM_HMAC_SECRET = prevHmac
    }
  })

  it('malformed tenant phone surfaces as upsert-phase error', async () => {
    const { deps, calls } = buildDeps({
      staff: [
        makeProfile({ userId: 'u-good', whatsappPhoneE164: '+6591111111' }),
        makeProfile({ userId: 'u-bad', whatsappPhoneE164: '+0invalid' }),
      ],
      platform: [],
    })
    const result = await syncStaffLinks(baseCtx, {}, deps)
    // The good one still syncs.
    expect(result.applied.upserted).toBe(1)
    expect(calls.upsert).toEqual([{ staffUserId: 'u-good', staffPhoneE164: '+6591111111' }])
    // The bad one logs an error and is skipped.
    expect(result.errors.some((e) => e.staffPhoneE164 === '+0invalid')).toBe(true)
  })
})
