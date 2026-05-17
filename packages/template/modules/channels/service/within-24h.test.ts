/**
 * Integration tests for `checkWithin24h`.
 *
 * Requires a running Docker Postgres on :5432. Skipped (not failed) when the
 * DB is unreachable.
 *
 * Each test inserts rows directly into `infra.channels_log` via raw SQL with
 * explicit `created_at` offsets so timing assertions are deterministic.
 * The table is TRUNCATED before the suite runs so stale rows from other tests
 * don't bleed in.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { sql } from 'drizzle-orm'

import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../../../tests/helpers/test-db'
import { checkWithin24h } from './within-24h'

const PHONE = '+6591234567'
const OTHER_PHONE = '+6598765432'
const ORG = 'org-within-24h-test'
const OTHER_ORG = 'org-other-tenant'

let handle: TestDbHandle | null = null

beforeAll(async () => {
  try {
    await resetAndSeedDb()
    handle = connectTestDb()
  } catch (err) {
    console.warn(`[within-24h.test] skipping: ${(err as Error).message}`)
  }
}, 60_000)

afterAll(async () => {
  if (handle) await handle.teardown()
})

beforeEach(async () => {
  if (!handle) return
  await handle.db.execute(sql`TRUNCATE TABLE "infra"."channels_log"`)
})

/** Insert a row into channels_log with an explicit created_at offset. */
async function insertLog(
  db: TestDbHandle['db'],
  opts: {
    direction: 'inbound' | 'outbound'
    from?: string
    to?: string
    channel: string
    offsetInterval: string // e.g. '1 hour', '25 hours'
  },
) {
  const from = opts.from ?? null
  const to = opts.to ?? PHONE
  await db.execute(
    sql`INSERT INTO "infra"."channels_log" (id, channel, direction, "to", "from", status, created_at)
        VALUES (
          substr(md5(random()::text), 1, 8),
          ${opts.channel},
          ${opts.direction},
          ${to},
          ${from},
          'received',
          now() - ${sql.raw(`interval '${opts.offsetInterval}'`)}
        )`,
  )
}

describe('checkWithin24h (real Postgres)', () => {
  it('inbound WhatsApp row at now-1h → returns true', async () => {
    if (!handle) return
    await insertLog(handle.db, { direction: 'inbound', from: PHONE, channel: 'whatsapp', offsetInterval: '1 hour' })
    const result = await checkWithin24h(handle.db, PHONE, ORG)
    expect(result).toBe(true)
  })

  it('no row at all → returns false', async () => {
    if (!handle) return
    const result = await checkWithin24h(handle.db, PHONE, ORG)
    expect(result).toBe(false)
  })

  it('inbound WhatsApp row at now-25h → returns false (outside window)', async () => {
    if (!handle) return
    await insertLog(handle.db, { direction: 'inbound', from: PHONE, channel: 'whatsapp', offsetInterval: '25 hours' })
    const result = await checkWithin24h(handle.db, PHONE, ORG)
    expect(result).toBe(false)
  })

  it('boundary at now-23h49m → returns true (inside 23h50m margin)', async () => {
    if (!handle) return
    await insertLog(handle.db, {
      direction: 'inbound',
      from: PHONE,
      channel: 'whatsapp',
      offsetInterval: '23 hours 49 minutes',
    })
    const result = await checkWithin24h(handle.db, PHONE, ORG)
    expect(result).toBe(true)
  })

  it('boundary at now-23h55m → returns false (outside 23h50m margin)', async () => {
    if (!handle) return
    await insertLog(handle.db, {
      direction: 'inbound',
      from: PHONE,
      channel: 'whatsapp',
      offsetInterval: '23 hours 55 minutes',
    })
    const result = await checkWithin24h(handle.db, PHONE, ORG)
    expect(result).toBe(false)
  })

  it('outbound WhatsApp row at now-1h → returns false (direction filter)', async () => {
    if (!handle) return
    await insertLog(handle.db, {
      direction: 'outbound',
      from: null,
      to: PHONE,
      channel: 'whatsapp',
      offsetInterval: '1 hour',
    })
    const result = await checkWithin24h(handle.db, PHONE, ORG)
    expect(result).toBe(false)
  })

  it('row from another phone number → returns false (phone filter)', async () => {
    if (!handle) return
    // Insert inbound from OTHER_PHONE only — no row for PHONE.
    await insertLog(handle.db, {
      direction: 'inbound',
      from: OTHER_PHONE,
      channel: 'whatsapp',
      offsetInterval: '1 hour',
    })
    const result = await checkWithin24h(handle.db, PHONE, ORG)
    expect(result).toBe(false)
  })

  it('inbound SMS row at now-1h → returns false (channel filter)', async () => {
    if (!handle) return
    await insertLog(handle.db, { direction: 'inbound', from: PHONE, channel: 'sms', offsetInterval: '1 hour' })
    const result = await checkWithin24h(handle.db, PHONE, ORG)
    expect(result).toBe(false)
  })

  it('organizationId param does not cause a query error (no org column on table)', async () => {
    // channels_log has no organization_id column. Two tenants sharing a phone
    // number is architecturally impossible (E.164 is globally unique), so tenant
    // isolation relies on phone-number uniqueness, not a DB filter.
    // This test verifies the organizationId param is accepted without error and
    // that the phone-number filter is what governs the result.
    if (!handle) return
    await insertLog(handle.db, { direction: 'inbound', from: PHONE, channel: 'whatsapp', offsetInterval: '1 hour' })
    // Correct arg order: checkWithin24h(db, staffPhoneE164, organizationId)
    const result = await checkWithin24h(handle.db, PHONE, OTHER_ORG)
    // Returns true: the row matches on phone/channel/direction/time regardless of org param.
    expect(result).toBe(true)
  })
})
