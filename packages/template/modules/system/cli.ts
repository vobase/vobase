/**
 * `vobase resources {list,export}` and `vobase install` verb shells.
 *
 * These are cross-cutting infrastructure verbs that sit in the `system`
 * module so they boot last (after every module has had a chance to call
 * `defineDeclarativeResource` + `bindDeclarativeTable`).
 *
 * The full install/export semantics land in Slice 3 alongside the
 * `defaults/` directory convention. For now:
 *  - `resources list` returns the registry shape (works pre-Slice-3 too)
 *  - `resources export` walks rows and serializes them via `resource.serialize`
 *  - `install` returns a structured `not_implemented` response so the verb
 *    is in the catalog from day one (binary stays forward-compatible)
 */

import { resolve } from 'node:path'
import { defineCliVerb, getDeclarativeResource, getDeclarativeTable, listDeclarativeResources } from '@vobase/core'
import { and, eq, sql } from 'drizzle-orm'
import type { AnyPgColumn, AnyPgTable } from 'drizzle-orm/pg-core'
import { z } from 'zod'

import type { ScopedDb } from '~/runtime'
import { runDefaultsInstall } from './install-defaults'

interface AuthoredRow {
  body: unknown
  origin: 'file' | 'user' | 'agent'
  fileSourcePath?: string | null
}

interface ExportCols {
  slug: AnyPgColumn
  scope: AnyPgColumn
}

let _db: ScopedDb | null = null
let _rootDir: string = process.cwd()

export function setResourcesDb(db: ScopedDb, rootDir = process.cwd()): void {
  _db = db
  _rootDir = rootDir
}

export const resourcesListVerb = defineCliVerb({
  name: 'resources list',
  description: 'List every declarative-resource kind that modules have registered.',
  audience: 'admin',
  input: z.object({}),
  // biome-ignore lint/suspicious/useAwait: contract requires async
  body: async () => {
    const rows = listDeclarativeResources().map((r) => ({
      kind: r.kind,
      format: r.format,
      sourceGlobs: r.sourceGlobs,
    }))
    return { ok: true as const, data: rows }
  },
  formatHint: 'table:cols=kind,format,sourceGlobs',
})

export const resourcesExportVerb = defineCliVerb({
  name: 'resources export',
  description: 'Serialize a runtime-mutated row back to disk so it can be checked into the source tree.',
  audience: 'admin',
  input: z.object({
    kind: z.string().min(1),
    slug: z.string().min(1),
    scope: z.string().nullable().optional(),
    out: z.string().optional(),
  }),
  body: async ({ input }) => {
    if (!_db) {
      return { ok: false as const, error: 'resources db not installed', errorCode: 'not_ready' }
    }
    const resource = getDeclarativeResource(input.kind)
    if (!resource) {
      return { ok: false as const, error: `unknown resource kind: ${input.kind}`, errorCode: 'unknown_kind' }
    }
    const table = getDeclarativeTable(input.kind) as AnyPgTable | undefined
    if (!table) {
      return {
        ok: false as const,
        error: `kind "${input.kind}" has no bound table — bindDeclarativeTable() not called`,
        errorCode: 'unbound_table',
      }
    }
    const cols = table as unknown as ExportCols
    const scope = input.scope ?? null
    const rows = (await _db
      .select()
      .from(table)
      .where(
        and(eq(cols.slug, input.slug), scope === null ? sql`scope IS NULL` : eq(cols.scope, scope)),
      )) as unknown as AuthoredRow[]
    const row = rows[0]
    if (!row) {
      return {
        ok: false as const,
        error: `no row for kind=${input.kind} slug=${input.slug} scope=${scope ?? '<null>'}`,
        errorCode: 'not_found',
      }
    }
    if (row.origin === 'file') {
      return {
        ok: false as const,
        error: `row origin is 'file' — already in sync with disk; no export needed`,
        errorCode: 'origin_file',
      }
    }
    const targetRel = input.out ?? row.fileSourcePath
    if (!targetRel) {
      return {
        ok: false as const,
        error: 'row has no fileSourcePath; pass --out=<path> to choose a destination',
        errorCode: 'no_target_path',
      }
    }
    const content = resource.serialize(row.body)
    const targetAbs = resolve(_rootDir, targetRel)
    await Bun.write(targetAbs, content)
    return {
      ok: true as const,
      data: { path: targetRel, bytesWritten: new TextEncoder().encode(content).byteLength },
    }
  },
  formatHint: 'json',
})

export const installVerb = defineCliVerb({
  name: 'install',
  description: 'Install module defaults from each module‘s defaults/ directory.',
  audience: 'admin',
  input: z.object({
    defaults: z.boolean().optional(),
    upgrade: z.boolean().optional(),
    kind: z.string().optional(),
    prune: z.boolean().optional(),
  }),
  body: async ({ input }) => {
    if (!input.defaults && !input.upgrade) {
      return {
        ok: false as const,
        error: 'pass --defaults to seed missing module defaults or --upgrade to refresh file-origin rows',
        errorCode: 'usage',
      }
    }
    try {
      const result = await runDefaultsInstall({ upgrade: input.upgrade ?? false, prune: input.prune ?? false })
      return { ok: true as const, data: result }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        errorCode: 'install_failed',
      }
    }
  },
  formatHint: 'json',
})

export const systemVerbs = [resourcesListVerb, resourcesExportVerb, installVerb] as const
