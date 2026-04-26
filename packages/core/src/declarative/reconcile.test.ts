/**
 * Reconciler unit tests.
 *
 * Use a real tmpdir for source files (Bun.Glob is the supported path) plus
 * a stub DB that records insert/update/select calls in-memory. No Postgres.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { reconcilerAudit } from '../schemas/declarative'
import { __resetDeclarativeRegistryForTests, defineDeclarativeResource } from './define'
import { reconcileResource } from './reconcile'
import type { Authored, DeclarativeResource } from './types'

interface StubRow {
  id: string
  slug: string
  scope: string | null
  body: unknown
  origin: 'file' | 'user' | 'agent'
  fileSourcePath: string | null
  fileContentHash: string | null
  active: boolean
}

/**
 * Minimal in-memory DB that satisfies the reconciler's `select / insert /
 * update` call shape. One Map per table. Filters that the reconciler builds
 * via Drizzle's `eq`/`and`/`isNotNull`/`sql` are returned as opaque tokens
 * here — the stub re-evaluates by reading every row and applying the
 * caller's recorded predicate from a side-channel `lastWhere` slot.
 */
function makeStubDb() {
  const tableRows = new Map<unknown, StubRow[]>()
  const auditRows: Array<Record<string, unknown>> = []

  function ensure(tableKey: unknown): StubRow[] {
    let arr = tableRows.get(tableKey)
    if (!arr) {
      arr = []
      tableRows.set(tableKey, arr)
    }
    return arr
  }

  let nextId = 1

  // The reconciler builds where-predicates as Drizzle SQL tokens; we can't
  // execute those, so the stub matches by mirror state stored in `pendingFilter`
  // — set by the test before each select/update call.
  let pendingFilter: ((r: StubRow) => boolean) | null = null

  const db = {
    setFilter: (fn: ((r: StubRow) => boolean) | null) => {
      pendingFilter = fn
    },
    select: () => ({
      from: (table: unknown) => ({
        where: (_w: unknown) => {
          const filter = pendingFilter ?? (() => true)
          pendingFilter = null
          return Promise.resolve(ensure(table).filter(filter))
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: unknown) => {
        if (table === reconcilerAudit) {
          auditRows.push(v as Record<string, unknown>)
          return Promise.resolve()
        }
        const row = v as Omit<StubRow, 'id'>
        ensure(table).push({ id: `row_${nextId++}`, ...row })
        return Promise.resolve()
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Partial<StubRow>) => ({
        where: (_w: unknown) => {
          const arr = ensure(table)
          const filter = pendingFilter ?? (() => true)
          pendingFilter = null
          for (const r of arr) {
            if (filter(r)) Object.assign(r, patch)
          }
          return Promise.resolve()
        },
      }),
    }),
  }

  return { db, tableRows, auditRows, ensure }
}

// ---------------------------------------------------------------------------

describe('reconcileResource', () => {
  let dir: string
  let resource: DeclarativeResource<{ name: string; filters?: unknown[] }>

  beforeEach(async () => {
    __resetDeclarativeRegistryForTests()
    dir = await mkdtemp(join(tmpdir(), 'declarative-test-'))
    await mkdir(join(dir, 'modules', 'contacts', 'views'), { recursive: true })
    resource = defineDeclarativeResource({
      kind: 'demo_views',
      sourceGlobs: 'modules/*/views/*.view.yaml',
      format: 'yaml',
      bodySchema: z.object({ name: z.string(), filters: z.array(z.unknown()).optional() }),
      serialize: (b) => `name: ${b.name}\n`,
    })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('inserts a row for a freshly seen file', async () => {
    await writeFile(join(dir, 'modules', 'contacts', 'views', 'default.view.yaml'), 'name: Default\n')
    const fakeTable = Symbol('saved_views')
    const { db, ensure } = makeStubDb()

    const diff = await reconcileResource(
      { db: db as unknown as Parameters<typeof reconcileResource>[0]['db'], rootDir: dir },
      { resource, table: fakeTable as unknown as Parameters<typeof reconcileResource>[1]['table'] },
    )

    expect(diff.inserted).toBe(1)
    expect(diff.updated).toBe(0)
    expect(diff.tombstoned).toBe(0)
    const rows = ensure(fakeTable)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.slug).toBe('default')
    expect(rows[0]?.origin).toBe('file')
    expect(rows[0]?.fileSourcePath).toBe('modules/contacts/views/default.view.yaml')
    expect(rows[0]?.body).toEqual({ name: 'Default' })
  })

  it('skips when content hash matches on second pass (idempotent)', async () => {
    await writeFile(join(dir, 'modules', 'contacts', 'views', 'default.view.yaml'), 'name: Default\n')
    const fakeTable = Symbol('saved_views')
    const { db } = makeStubDb()

    await reconcileResource(
      { db: db as unknown as Parameters<typeof reconcileResource>[0]['db'], rootDir: dir },
      { resource, table: fakeTable as unknown as Parameters<typeof reconcileResource>[1]['table'] },
    )
    const second = await reconcileResource(
      { db: db as unknown as Parameters<typeof reconcileResource>[0]['db'], rootDir: dir },
      { resource, table: fakeTable as unknown as Parameters<typeof reconcileResource>[1]['table'] },
    )

    expect(second.inserted).toBe(0)
    expect(second.skipped).toBeGreaterThanOrEqual(1)
  })

  it('tombstones when source file disappears', async () => {
    const path = join(dir, 'modules', 'contacts', 'views', 'gone.view.yaml')
    await writeFile(path, 'name: Will-Be-Gone\n')
    const fakeTable = Symbol('saved_views')
    const { db, ensure } = makeStubDb()

    await reconcileResource(
      { db: db as unknown as Parameters<typeof reconcileResource>[0]['db'], rootDir: dir },
      { resource, table: fakeTable as unknown as Parameters<typeof reconcileResource>[1]['table'] },
    )
    expect(ensure(fakeTable)).toHaveLength(1)

    await rm(path)
    const after = await reconcileResource(
      { db: db as unknown as Parameters<typeof reconcileResource>[0]['db'], rootDir: dir },
      { resource, table: fakeTable as unknown as Parameters<typeof reconcileResource>[1]['table'] },
    )
    expect(after.tombstoned).toBe(1)
    expect(ensure(fakeTable)[0]?.active).toBe(false)
  })

  it('protects rows whose origin is user/agent — records drift, no overwrite', async () => {
    const path = join(dir, 'modules', 'contacts', 'views', 'edited.view.yaml')
    await writeFile(path, 'name: Original\n')
    const fakeTable = Symbol('saved_views')
    const { db, ensure, auditRows } = makeStubDb()

    await reconcileResource(
      { db: db as unknown as Parameters<typeof reconcileResource>[0]['db'], rootDir: dir },
      { resource, table: fakeTable as unknown as Parameters<typeof reconcileResource>[1]['table'] },
    )
    // Simulate a runtime "Save view" — flip origin and patch body.
    const row = ensure(fakeTable)[0] as StubRow
    row.origin = 'user'
    row.body = { name: 'User-Edited' }

    // File changes upstream:
    await writeFile(path, 'name: NewFromFile\n')
    const after = await reconcileResource(
      { db: db as unknown as Parameters<typeof reconcileResource>[0]['db'], rootDir: dir },
      { resource, table: fakeTable as unknown as Parameters<typeof reconcileResource>[1]['table'] },
    )
    expect(after.conflicts).toBe(1)
    expect(after.updated).toBe(0)
    expect((ensure(fakeTable)[0] as StubRow).body).toEqual({ name: 'User-Edited' })
    const drift = auditRows.find((a) => a.kind === 'drift_detected')
    expect(drift).toBeDefined()
  })
})

// Placate ts-unused — we expose Authored only for cross-test type sanity.
type _AuthoredOk = Authored<{ name: string }>['origin']
const _ok: _AuthoredOk = 'file'
void _ok
