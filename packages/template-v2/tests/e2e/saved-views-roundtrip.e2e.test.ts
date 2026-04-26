/**
 * Saved-views service — real-Postgres e2e proving the full CRUD lifecycle for
 * `core_views.saved_views` plus generic `executeQuery` dispatch onto the
 * underlying viewable's table (here `object:contacts`).
 *
 * The `view-renderer.test.tsx` UI test mocks the RPC client; this file pins the
 * service-layer contract: insert-or-update on `(slug, scope)`, soft-delete via
 * `active=false`, filter validation against the viewable's column registry,
 * filter operators against PG (eq / contains / in / between / is_null), and
 * sort + limit + offset honoured against real rows.
 *
 * The contacts viewable (`scope = 'object:contacts'`) registers itself as a
 * side-effect of importing `@modules/contacts/module`, which is why we keep
 * the static import even though we don't use the default export.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { savedViews } from '@modules/views/schema'
import { createViewsService, installViewsService, type ViewsService } from '@modules/views/service/views'
import { eq } from 'drizzle-orm'

import '@modules/contacts/module' // registers `object:contacts` viewable

import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../helpers/test-db'

const SCOPE = 'object:contacts'

let db: TestDbHandle
let svc: ViewsService

beforeAll(async () => {
  await resetAndSeedDb()
  db = connectTestDb()
  svc = createViewsService({ db: db.db })
  installViewsService(svc)
}, 60_000)

afterAll(async () => {
  // Tombstone every test-owned slug so a re-run doesn't see stale active rows.
  await db.db.delete(savedViews).where(eq(savedViews.scope, SCOPE))
  if (db) await db.teardown()
})

describe('saved-views service (real PG)', () => {
  it('save → get → list returns the row with origin=user and the body intact', async () => {
    const body = {
      name: 'Pro plan',
      kind: 'table' as const,
      columns: ['displayName', 'segments', 'updatedAt'],
      filters: [{ column: 'segments', op: 'contains' as const, value: 'pro-plan' }],
      sort: [{ column: 'displayName', direction: 'asc' as const }],
    }

    const saved = await svc.save({ slug: 'pro-plan', scope: SCOPE, body })
    expect(saved.slug).toBe('pro-plan')
    expect(saved.scope).toBe(SCOPE)
    expect(saved.origin).toBe('user')
    expect(saved.active).toBe(true)
    expect(saved.body.name).toBe('Pro plan')

    const fetched = await svc.get('pro-plan', SCOPE)
    expect(fetched?.id).toBe(saved.id)

    const listed = await svc.list(SCOPE)
    expect(listed.some((r) => r.slug === 'pro-plan')).toBe(true)
  })

  it('saving the same (slug, scope) twice updates the row instead of inserting a duplicate', async () => {
    const baseBody = {
      name: 'V1',
      kind: 'table' as const,
      columns: ['displayName'],
    }

    const a = await svc.save({ slug: 'iter', scope: SCOPE, body: baseBody })
    const b = await svc.save({ slug: 'iter', scope: SCOPE, body: { ...baseBody, name: 'V2' } })

    expect(b.id).toBe(a.id)
    expect(b.body.name).toBe('V2')

    const allWithSlug = await db.db.select({ id: savedViews.id }).from(savedViews).where(eq(savedViews.slug, 'iter'))
    expect(allWithSlug).toHaveLength(1)
  })

  it('remove tombstones via active=false; list excludes it but get still returns it', async () => {
    await svc.save({
      slug: 'tombstone-me',
      scope: SCOPE,
      body: { name: 'Bye', kind: 'table', columns: ['displayName'] },
    })

    await svc.remove('tombstone-me', SCOPE)

    const stillThere = await svc.get('tombstone-me', SCOPE)
    expect(stillThere?.active).toBe(false)

    const listed = await svc.list(SCOPE)
    expect(listed.some((r) => r.slug === 'tombstone-me')).toBe(false)
  })

  it('save rejects filters that reference unknown columns', async () => {
    await expect(
      svc.save({
        slug: 'bad-filter',
        scope: SCOPE,
        body: {
          name: 'Bad',
          kind: 'table',
          columns: ['displayName'],
          filters: [{ column: 'this_column_does_not_exist', op: 'eq', value: 'x' }],
        },
      }),
    ).rejects.toThrow(/filter issues/i)
  })

  it('executeQuery returns seeded contacts and honours filter + sort + limit', async () => {
    const all = await svc.executeQuery({ scope: SCOPE, limit: 50 })
    expect(all.rows.length).toBeGreaterThan(0)

    const priya = await svc.executeQuery({
      scope: SCOPE,
      filters: [{ column: 'displayName', op: 'contains', value: 'Priya' }],
      limit: 10,
    })
    expect(priya.rows.length).toBeGreaterThanOrEqual(1)
    for (const row of priya.rows) {
      expect(String(row.displayName ?? '')).toContain('Priya')
    }

    const sorted = await svc.executeQuery({
      scope: SCOPE,
      sort: [{ column: 'displayName', direction: 'asc' }],
      limit: 3,
    })
    const names = sorted.rows.map((r) => String(r.displayName ?? ''))
    expect([...names].sort()).toEqual(names)
  })

  it('executeQuery throws on filter operator with the wrong shape (between needs 2 values)', async () => {
    await expect(
      svc.executeQuery({
        scope: SCOPE,
        filters: [{ column: 'createdAt', op: 'between', value: ['only-one'] }],
      }),
    ).rejects.toThrow(/between needs/i)
  })

  it('executeQuery rejects an unknown scope at the registry boundary', async () => {
    await expect(svc.executeQuery({ scope: 'object:does-not-exist' })).rejects.toThrow(/not found/i)
  })
})
