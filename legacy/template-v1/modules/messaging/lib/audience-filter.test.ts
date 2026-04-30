import { beforeEach, describe, expect, it } from 'bun:test'
import type { VobaseDb } from '@vobase/core'

import { createTestDb } from '../../../lib/test-helpers'
import { contacts } from '../schema'
import { type AttributeOperator, audienceFilterSchema, buildAudienceConditions } from './audience-filter'

let db: VobaseDb

beforeEach(async () => {
  const result = await createTestDb()
  db = result.db
})

// ─── Shape-level assertions (no DB) ────────────────────────────────

describe('buildAudienceConditions — shape', () => {
  it('always requires a non-null phone number', () => {
    const where = buildAudienceConditions({ excludeOptedOut: false })
    expect(where).toBeDefined()
  })

  it('returns a condition with roles filter (single role)', () => {
    const where = buildAudienceConditions({
      roles: ['customer'],
      excludeOptedOut: false,
    })
    expect(where).toBeDefined()
  })

  it('returns a condition with roles filter (multiple roles)', () => {
    const where = buildAudienceConditions({
      roles: ['customer', 'lead', 'staff'],
      excludeOptedOut: false,
    })
    expect(where).toBeDefined()
  })

  it('returns a condition with attribute filters (default op=eq)', () => {
    const where = buildAudienceConditions({
      attributes: [
        { key: 'city', value: 'Singapore' },
        { key: 'plan', value: 'pro' },
      ],
      excludeOptedOut: false,
    })
    expect(where).toBeDefined()
  })

  it('ignores labelIds — label filtering is handled by caller', () => {
    const where = buildAudienceConditions({
      labelIds: ['lbl_123'],
      excludeOptedOut: false,
    })
    expect(where).toBeDefined()
  })
})

// ─── Zod schema — operator round-trip ──────────────────────────────

describe('audienceFilterSchema — operator field', () => {
  it('accepts attributes without op (back-compat)', () => {
    const parsed = audienceFilterSchema.parse({
      attributes: [{ key: 'city', value: 'Singapore' }],
    })
    expect(parsed.attributes?.[0].op).toBeUndefined()
  })

  it.each<AttributeOperator>(['eq', '!=', '>=', '<=', 'contains'])('accepts op=%s', (op) => {
    const parsed = audienceFilterSchema.parse({
      attributes: [{ key: 'k', value: 'v', op }],
    })
    expect(parsed.attributes?.[0].op).toBe(op)
  })

  it('rejects unknown operators', () => {
    expect(() =>
      audienceFilterSchema.parse({
        attributes: [{ key: 'k', value: 'v', op: 'regex' }],
      }),
    ).toThrow()
  })
})

// ─── SQL parameterization — security-critical ──────────────────────

describe('buildAudienceConditions — SQL parameterization', () => {
  it('parameterizes attribute keys/values — no raw values in SQL text', async () => {
    // An injection-looking string MUST appear in params, never in SQL text.
    const injection = "'; DROP TABLE contacts; --"
    const where = buildAudienceConditions({
      attributes: [{ key: 'city', value: injection, op: 'eq' }],
      excludeOptedOut: false,
    })
    expect(where).toBeDefined()

    const query = db.select().from(contacts).where(where).toSQL()
    // Raw user value must NOT appear inside the SQL string — it must be bound.
    expect(query.sql).not.toContain(injection)
    expect(query.sql).not.toContain('DROP TABLE')
    expect(query.params).toContain(injection)
    // Attribute key is also parameterized.
    expect(query.params).toContain('city')
  })

  it('parameterizes all five operators', () => {
    const ops: AttributeOperator[] = ['eq', '!=', '>=', '<=', 'contains']
    for (const op of ops) {
      const where = buildAudienceConditions({
        attributes: [{ key: 'plan', value: 'pro', op }],
        excludeOptedOut: false,
      })
      const query = db.select().from(contacts).where(where).toSQL()
      expect(query.sql).not.toContain("'pro'")
      expect(query.params).toContain('pro')
    }
  })
})

// ─── End-to-end behaviour against real PGlite ──────────────────────

async function seedAttributeContacts() {
  await db.insert(contacts).values([
    {
      id: 'ca',
      phone: '+6510000001',
      role: 'customer',
      attributes: { city: 'Singapore', plan: 'pro', age: '30' },
    },
    {
      id: 'cb',
      phone: '+6510000002',
      role: 'customer',
      attributes: { city: 'singapore', plan: 'free', age: '20' },
    },
    {
      id: 'cc',
      phone: '+6510000003',
      role: 'customer',
      attributes: { city: 'Jakarta', plan: 'pro', age: '40' },
    },
    {
      id: 'cd',
      phone: '+6510000004',
      role: 'customer',
      attributes: { city: 'Kuala Lumpur', plan: 'free', age: '25' },
    },
  ])
}

async function runQuery(filter: Parameters<typeof buildAudienceConditions>[0]) {
  const where = buildAudienceConditions(filter)
  const rows = await db.select({ id: contacts.id }).from(contacts).where(where)
  return rows.map((r) => r.id).sort()
}

describe('buildAudienceConditions — operator semantics', () => {
  beforeEach(async () => {
    await seedAttributeContacts()
  })

  it('op=eq matches exact value (case-sensitive) — default when op omitted', async () => {
    const omitted = await runQuery({
      attributes: [{ key: 'city', value: 'Singapore' }],
      excludeOptedOut: false,
    })
    const explicit = await runQuery({
      attributes: [{ key: 'city', value: 'Singapore', op: 'eq' }],
      excludeOptedOut: false,
    })
    expect(omitted).toEqual(['ca'])
    expect(explicit).toEqual(['ca'])
  })

  it('op=!= excludes exact matches', async () => {
    const ids = await runQuery({
      attributes: [{ key: 'plan', value: 'pro', op: '!=' }],
      excludeOptedOut: false,
    })
    expect(ids).toEqual(['cb', 'cd'])
  })

  it('op=>= compares lexicographically via text extraction', async () => {
    const ids = await runQuery({
      attributes: [{ key: 'age', value: '30', op: '>=' }],
      excludeOptedOut: false,
    })
    expect(ids).toEqual(['ca', 'cc'])
  })

  it('op=<= compares lexicographically via text extraction', async () => {
    const ids = await runQuery({
      attributes: [{ key: 'age', value: '25', op: '<=' }],
      excludeOptedOut: false,
    })
    expect(ids).toEqual(['cb', 'cd'])
  })

  it('op=contains performs case-insensitive substring match', async () => {
    const ids = await runQuery({
      attributes: [{ key: 'city', value: 'SING', op: 'contains' }],
      excludeOptedOut: false,
    })
    expect(ids).toEqual(['ca', 'cb'])
  })

  it('combines multiple attribute filters with different operators via AND', async () => {
    const ids = await runQuery({
      attributes: [
        { key: 'plan', value: 'pro', op: 'eq' },
        { key: 'city', value: 'sing', op: 'contains' },
      ],
      excludeOptedOut: false,
    })
    expect(ids).toEqual(['ca'])
  })
})
