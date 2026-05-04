/**
 * Race-safety + idempotency tests for `upsertManagedInstance`.
 *
 * Pre-fix this method did SELECT-then-INSERT/UPDATE — two concurrent
 * handshakes (boot auto-provision + admin fallback handler) could each pass
 * the existence probe and double-insert. The fix is a partial unique index
 * on `(organization_id, channel, platform_channel_id)` plus
 * INSERT … ON CONFLICT DO UPDATE; this test asserts the race ends with one
 * row.
 *
 * Skipped (not failed) when Docker Postgres is unreachable.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { channelInstances } from '@modules/channels/schema'
import { and, eq, sql } from 'drizzle-orm'

import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../../../tests/helpers/test-db'
import { upsertManagedInstance } from './instances'

const TEST_ORG = 'org-upsert-managed-test'
const TEST_PLATFORM_CHANNEL_ID = 'pc-acme-prod'

let dbHandle: TestDbHandle | null = null

beforeAll(async () => {
  try {
    await resetAndSeedDb()
    dbHandle = connectTestDb()
  } catch (err) {
    console.warn(`[instances.test] skipping: ${(err as Error).message}`)
  }
}, 60_000)

afterAll(async () => {
  if (dbHandle) await dbHandle.teardown()
})

beforeEach(async () => {
  if (!dbHandle) return
  await dbHandle.db.execute(sql`TRUNCATE TABLE "channels"."channel_instances" CASCADE`)
})

describe('upsertManagedInstance', () => {
  it('first call inserts, returns isNew=true', async () => {
    if (!dbHandle) return
    const { instance, isNew } = await upsertManagedInstance(dbHandle.db, {
      organizationId: TEST_ORG,
      channel: 'whatsapp',
      platformChannelId: TEST_PLATFORM_CHANNEL_ID,
      displayName: 'Acme prod',
      config: { phoneNumberId: '111', wabaId: '222' },
    })
    expect(isNew).toBe(true)
    expect(instance.platformChannelId).toBe(TEST_PLATFORM_CHANNEL_ID)
    expect(instance.config.platformChannelId).toBe(TEST_PLATFORM_CHANNEL_ID)
    expect(instance.config.mode).toBe('managed')
  })

  it('repeat call updates, returns isNew=false, preserves merged config keys', async () => {
    if (!dbHandle) return
    await upsertManagedInstance(dbHandle.db, {
      organizationId: TEST_ORG,
      channel: 'whatsapp',
      platformChannelId: TEST_PLATFORM_CHANNEL_ID,
      displayName: 'first',
      config: { phoneNumberId: '111', wabaId: '222', stale: 'keepme' },
    })
    const { instance, isNew } = await upsertManagedInstance(dbHandle.db, {
      organizationId: TEST_ORG,
      channel: 'whatsapp',
      platformChannelId: TEST_PLATFORM_CHANNEL_ID,
      displayName: 'second',
      config: { phoneNumberId: '999' },
    })
    expect(isNew).toBe(false)
    expect(instance.displayName).toBe('second')
    // Merge semantics: new payload overlays, untouched keys survive.
    expect(instance.config.phoneNumberId).toBe('999')
    expect(instance.config.wabaId).toBe('222')
    expect(instance.config.stale).toBe('keepme')
  })

  it('concurrent first-time upserts produce a single row', async () => {
    if (!dbHandle) return
    const args = {
      organizationId: TEST_ORG,
      channel: 'whatsapp' as const,
      platformChannelId: TEST_PLATFORM_CHANNEL_ID,
      displayName: 'racecond',
      config: { phoneNumberId: '111' },
    }
    const results = await Promise.all([
      upsertManagedInstance(dbHandle.db, args),
      upsertManagedInstance(dbHandle.db, args),
      upsertManagedInstance(dbHandle.db, args),
    ])
    expect(results).toHaveLength(3)
    const newCount = results.filter((r) => r.isNew).length
    expect(newCount).toBe(1)

    const rows = await dbHandle.db
      .select()
      .from(channelInstances)
      .where(and(eq(channelInstances.organizationId, TEST_ORG), eq(channelInstances.channel, 'whatsapp')))
    expect(rows).toHaveLength(1)
  })

  it('different platformChannelId values produce distinct rows', async () => {
    if (!dbHandle) return
    await upsertManagedInstance(dbHandle.db, {
      organizationId: TEST_ORG,
      channel: 'whatsapp',
      platformChannelId: 'pc-staging',
      displayName: 'staging',
      config: {},
    })
    await upsertManagedInstance(dbHandle.db, {
      organizationId: TEST_ORG,
      channel: 'whatsapp',
      platformChannelId: 'pc-production',
      displayName: 'prod',
      config: {},
    })
    const rows = await dbHandle.db.select().from(channelInstances).where(eq(channelInstances.organizationId, TEST_ORG))
    expect(rows).toHaveLength(2)
  })
})
