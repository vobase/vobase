/**
 * E2E: full boot reconcile cycle against a real Postgres-compatible DB.
 *
 * Drives `reconcileResource` over a real Drizzle table backed by PGlite —
 * the unit-tests use a stub DB that fakes the `where` predicate, but here
 * the actual SQL the reconciler builds (eq / and / isNotNull / sql`scope IS NULL`)
 * gets executed end-to-end. Also exercises the export CLI round-trip.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { pgTable } from 'drizzle-orm/pg-core'
import { z } from 'zod'

import type { VobaseDb } from '../../src/db/client'
import {
  bindDeclarativeTable,
  defineDeclarativeResource,
  getDeclarativeResource,
  reconcileResource,
  runExportCli,
} from '../../src/declarative'
import { authoredColumns, authoredConstraints } from '../../src/declarative/columns'
import { reconcilerAudit } from '../../src/schemas/declarative'
import { __resetDeclarativeBindingsForTests, __resetDeclarativeRegistryForTests } from '../../src/test-utils'
import { freshDb } from '../helpers/pglite'

interface ViewBody {
  name: string
  columns?: string[]
}

const savedViews = pgTable('declarative_e2e_views', authoredColumns<ViewBody>(), () =>
  authoredConstraints('declarative_e2e_views'),
)

let db: VobaseDb
let dir: string

beforeAll(async () => {
  const { db: d } = await freshDb()
  db = d
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS infra`)
  // PGlite has pgcrypto but not the `nanoid` extension prod uses, so we
  // synthesise a stable id default with md5(random()) for the test only.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "infra"."reconciler_audit" (
      id TEXT PRIMARY KEY DEFAULT substring(md5(random()::text) from 1 for 8),
      resource_kind TEXT NOT NULL,
      kind TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      slug TEXT,
      scope TEXT,
      detail JSONB NOT NULL DEFAULT '{}'::jsonb,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "declarative_e2e_views" (
      id TEXT PRIMARY KEY DEFAULT substring(md5(random()::text) from 1 for 8),
      slug TEXT NOT NULL,
      scope TEXT,
      body JSONB NOT NULL,
      origin TEXT NOT NULL DEFAULT 'file',
      file_source_path TEXT,
      file_content_hash TEXT,
      owner_staff_id TEXT,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT declarative_e2e_views_origin_check
        CHECK (origin IN ('file','user','agent')),
      CONSTRAINT uq_declarative_e2e_views_slug_scope
        UNIQUE (slug, scope)
    )
  `)
  // unique-index on (slug, coalesce(scope, '')) is harder to express portably;
  // PGlite accepts UNIQUE(slug, scope) which is sufficient for this suite —
  // production tables get the coalesce variant via authoredConstraints().
})

beforeEach(async () => {
  __resetDeclarativeRegistryForTests()
  __resetDeclarativeBindingsForTests()
  await db.execute(sql`TRUNCATE "declarative_e2e_views"`)
  await db.execute(sql`TRUNCATE "infra"."reconciler_audit"`)
  dir = await mkdtemp(join(tmpdir(), 'declarative-e2e-'))
  await mkdir(join(dir, 'modules', 'contacts', 'views'), { recursive: true })

  defineDeclarativeResource({
    kind: 'declarative_e2e_views',
    sourceGlobs: 'modules/*/views/*.view.yaml',
    format: 'yaml',
    bodySchema: z.object({
      name: z.string(),
      columns: z.array(z.string()).optional(),
    }) as unknown as z.ZodType<ViewBody>,
    parsePath: (ctx) => {
      const segs = ctx.relPath.split('/')
      return { slug: ctx.basename, scope: `object:${segs[1] ?? 'unknown'}` }
    },
    serialize: (b) => `name: ${b.name}\n`,
  })
  bindDeclarativeTable('declarative_e2e_views', savedViews)
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
})

function reconcile(): Promise<ReturnType<typeof reconcileResource>> {
  const resource = getDeclarativeResource('declarative_e2e_views')
  if (!resource) throw new Error('resource registered in beforeEach should exist')
  return reconcileResource(
    { db: db as unknown as Parameters<typeof reconcileResource>[0]['db'], rootDir: dir },
    { resource, table: savedViews },
  )
}

describe('declarative reconcile (e2e against PGlite)', () => {
  it('inserts → idempotent re-skip → tombstones → respects user origin → exports back', async () => {
    const path = join(dir, 'modules', 'contacts', 'views', 'default.view.yaml')
    await writeFile(path, 'name: Default\n')

    const first = await reconcile()
    expect(first.inserted).toBe(1)
    const inserted = await db.select().from(savedViews)
    expect(inserted).toHaveLength(1)
    expect(inserted[0]?.slug).toBe('default')
    expect(inserted[0]?.scope).toBe('object:contacts')
    expect(inserted[0]?.origin).toBe('file')
    expect((inserted[0]?.body as ViewBody).name).toBe('Default')

    // Idempotent re-run.
    const second = await reconcile()
    expect(second.inserted).toBe(0)
    expect(second.updated).toBe(0)
    expect(second.skipped).toBeGreaterThanOrEqual(1)

    // File update — origin still 'file', so reconciler updates body + hash.
    await writeFile(path, 'name: Renamed\n')
    const third = await reconcile()
    expect(third.updated).toBe(1)
    const updated = await db.select().from(savedViews)
    expect((updated[0]?.body as ViewBody).name).toBe('Renamed')

    // Flip origin to 'user' simulating an in-app save.
    await db
      .update(savedViews)
      .set({ origin: 'user', body: { name: 'UserSaved' } as unknown as ViewBody })
      .where(eq(savedViews.slug, 'default'))

    // Subsequent file change must NOT clobber — drift recorded instead.
    await writeFile(path, 'name: WouldClobber\n')
    const fourth = await reconcile()
    expect(fourth.conflicts).toBe(1)
    expect(fourth.updated).toBe(0)
    const after = await db.select().from(savedViews)
    expect((after[0]?.body as ViewBody).name).toBe('UserSaved')

    const audits = await db.select().from(reconcilerAudit).where(eq(reconcilerAudit.kind, 'drift_detected'))
    expect(audits).toHaveLength(1)
    expect(audits[0]?.scope).toBe('object:contacts')

    // Export CLI: write the user-edited body back to a new file path.
    let written: { path: string; content: string } | null = null
    const result = await runExportCli(
      {
        db,
        rootDir: dir,
        writeFile: (p, c) => {
          written = { path: p, content: c }
          return Promise.resolve()
        },
      },
      {
        kind: 'declarative_e2e_views',
        slug: 'default',
        scope: 'object:contacts',
        out: 'modules/contacts/views/default.user.view.yaml',
      },
    )
    expect(result.relPath).toBe('modules/contacts/views/default.user.view.yaml')
    expect(written).not.toBeNull()
    expect(written?.content).toContain('UserSaved')

    // Also exercise the file-source fallback after persisting a new file path
    // back through the export adapter (writes via the real fs to confirm
    // round-trip readability).
    await writeFile(written?.path, written?.content)
    const reread = await readFile(written?.path, 'utf8')
    expect(reread).toContain('UserSaved')

    // File deletion — original path goes away, but row was no longer
    // file-origin so it must NOT be tombstoned.
    await rm(path)
    const fifth = await reconcile()
    expect(fifth.tombstoned).toBe(0)
    const stillThere = await db.select().from(savedViews)
    expect(stillThere[0]?.active).toBe(true)
  })

  it('tombstones a file-origin row when its source disappears', async () => {
    const path = join(dir, 'modules', 'contacts', 'views', 'gone.view.yaml')
    await writeFile(path, 'name: Soon\n')
    const first = await reconcile()
    expect(first.inserted).toBe(1)
    await rm(path)
    const second = await reconcile()
    expect(second.tombstoned).toBe(1)
    const rows = await db.select().from(savedViews)
    expect(rows[0]?.active).toBe(false)
  })
})
