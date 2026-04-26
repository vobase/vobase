/**
 * Boot reconciler for declarative resources.
 *
 * For each registered resource, walk its source globs, hash + parse + validate
 * each file, then upsert into the resource's Drizzle table. File-origin rows
 * whose source disappears get tombstoned (`active = false`); rows whose
 * `origin !== 'file'` are protected — drift is recorded, never overwritten.
 *
 * Idempotent: a second `reconcile()` run with no source changes touches no
 * rows beyond a redundant audit-table noop.
 */

import { join, relative, sep } from 'node:path'
import { eq } from 'drizzle-orm'
import type { AnyPgColumn, AnyPgTable } from 'drizzle-orm/pg-core'

import { recordDriftConflict, recordReconcilerAudit } from './drift'
import { parseFileBytes } from './parse'
import type { Authored, DeclarativeResource, Origin, ParseFileContext, ReconcileDiff } from './types'

export interface ReconcileDeps {
  db: ReconcilerDb
  rootDir: string
  /** Logger for non-audit-worthy reconciler chatter (e.g. file-not-found). */
  log?: (msg: string, meta?: Record<string, unknown>) => void
}

/**
 * Minimal database surface the reconciler depends on. Structurally
 * compatible with Drizzle's `PostgresJsDatabase` — we keep it permissive
 * because the reconciler must operate over arbitrary `AnyPgTable`s.
 */
// biome-ignore lint/complexity/noBannedTypes: matches the established cross-module Function-shape pattern
export type ReconcilerDb = { select: Function; insert: Function; update: Function }

export interface ReconcileResourceArgs<TBody> {
  resource: DeclarativeResource<TBody>
  /** Drizzle table the rows live in. Must include the `Authored<T>` columns. */
  table: AnyPgTable
}

interface AuthoredCols {
  id: AnyPgColumn
  slug: AnyPgColumn
  scope: AnyPgColumn
  origin: AnyPgColumn
  active: AnyPgColumn
  fileSourcePath: AnyPgColumn
}

const DEFAULT_PARSE_PATH = (ctx: ParseFileContext): { slug: string; scope: string | null } => ({
  slug: ctx.basename,
  scope: ctx.parentDir.includes(':') || ctx.parentDir === 'views' ? null : ctx.parentDir,
})

function requireBun(): typeof Bun {
  const candidate = (globalThis as { Bun?: typeof Bun }).Bun
  if (!candidate) {
    throw new Error(
      'declarative: Bun runtime is required (Bun.CryptoHasher / Bun.file / Bun.Glob). Run via `bun` rather than `node`.',
    )
  }
  return candidate
}

async function hashUtf8(content: string): Promise<string> {
  return new (requireBun().CryptoHasher)('sha256').update(content).digest('hex')
}

function parseContext(filePath: string, rootDir: string): ParseFileContext {
  const relPath = relative(rootDir, filePath)
  const segs = relPath.split(sep)
  const file = segs[segs.length - 1] ?? relPath
  const parent = segs[segs.length - 2] ?? ''
  const dot = file.indexOf('.')
  const basename = dot === -1 ? file : file.slice(0, dot)
  return { filePath, relPath, basename, parentDir: parent }
}

export async function reconcileResource<TBody>(
  deps: ReconcileDeps,
  args: ReconcileResourceArgs<TBody>,
): Promise<ReconcileDiff> {
  const { resource, table } = args
  const cols = table as unknown as AuthoredCols
  const diff: Mutable<ReconcileDiff> = {
    kind: resource.kind,
    inserted: 0,
    updated: 0,
    skipped: 0,
    tombstoned: 0,
    conflicts: 0,
  }

  const seenPaths = new Set<string>()
  const filePaths = await globMany(deps.rootDir, resource.sourceGlobs)

  // Batch-load every row once so the per-file path doesn't issue an N+1
  // SELECT against the resource's table. We only need active+inactive rows
  // here since reconcile may revive a tombstoned row when its file returns.
  const existingRows = (await deps.db.select().from(table)) as Authored<unknown>[]
  const rowByKey = new Map<string, Authored<unknown>>()
  for (const r of existingRows) rowByKey.set(rowKey(r.slug, r.scope), r)

  for (const filePath of filePaths) {
    seenPaths.add(filePath)
    let raw: string
    try {
      raw = await requireBun().file(filePath).text()
    } catch (err) {
      deps.log?.(`reconcile: cannot read ${filePath}`, { err: String(err) })
      diff.skipped += 1
      continue
    }

    let parsed: ReturnType<typeof parseFileBytes>
    try {
      parsed = parseFileBytes(resource.format, raw)
    } catch (err) {
      await recordReconcilerAudit(deps, {
        resourceKind: resource.kind,
        kind: 'parse_error',
        severity: 'error',
        slug: null,
        scope: null,
        detail: { filePath, error: String(err) },
      })
      diff.skipped += 1
      continue
    }

    const validation = resource.bodySchema.safeParse(parsed.body)
    if (!validation.success) {
      await recordReconcilerAudit(deps, {
        resourceKind: resource.kind,
        kind: 'parse_error',
        severity: 'error',
        slug: null,
        scope: null,
        detail: { filePath, issues: validation.error.issues },
      })
      diff.skipped += 1
      continue
    }

    const ctx = parseContext(filePath, deps.rootDir)
    const { slug, scope } = (resource.parsePath ?? DEFAULT_PARSE_PATH)(ctx)
    const hash = await hashUtf8(parsed.hashableContent)
    const relFilePath = relative(deps.rootDir, filePath)

    const row = rowByKey.get(rowKey(slug, scope))

    if (!row) {
      await deps.db.insert(table).values({
        slug,
        scope,
        body: validation.data,
        origin: 'file' satisfies Origin,
        fileSourcePath: relFilePath,
        fileContentHash: hash,
        ownerStaffId: null,
        active: true,
      })
      await recordReconcilerAudit(deps, {
        resourceKind: resource.kind,
        kind: 'inserted',
        slug,
        scope,
        detail: { filePath: relFilePath, hash },
      })
      diff.inserted += 1
      continue
    }

    if (row.fileContentHash === hash) {
      if (!row.active) {
        await deps.db.update(table).set({ active: true, fileSourcePath: relFilePath }).where(eq(cols.id, row.id))
        diff.updated += 1
      } else {
        diff.skipped += 1
      }
      continue
    }

    if (row.origin === 'file') {
      await deps.db
        .update(table)
        .set({
          body: validation.data,
          fileSourcePath: relFilePath,
          fileContentHash: hash,
          active: true,
        })
        .where(eq(cols.id, row.id))
      await recordReconcilerAudit(deps, {
        resourceKind: resource.kind,
        kind: 'updated',
        slug,
        scope,
        detail: { filePath: relFilePath, hash },
      })
      diff.updated += 1
      continue
    }

    await recordDriftConflict(deps, {
      resourceKind: resource.kind,
      row,
      filePath: relFilePath,
      fileHash: hash,
    })
    diff.conflicts += 1
  }

  // Tombstone rows whose source vanished. Only file-origin rows; user/agent
  // rows have no source-of-truth contract with disk. Reuses the batch-loaded
  // row set instead of re-querying.
  const filePathsRel = new Set(Array.from(seenPaths).map((p) => relative(deps.rootDir, p)))
  for (const row of existingRows) {
    if (row.origin !== 'file') continue
    if (!row.active) continue
    if (!row.fileSourcePath) continue
    if (filePathsRel.has(row.fileSourcePath)) continue
    await deps.db.update(table).set({ active: false }).where(eq(cols.id, row.id))
    await recordReconcilerAudit(deps, {
      resourceKind: resource.kind,
      kind: 'tombstoned',
      slug: row.slug,
      scope: row.scope,
      detail: { fileSourcePath: row.fileSourcePath },
    })
    diff.tombstoned += 1
  }

  return diff
}

function rowKey(slug: string, scope: string | null): string {
  return `${slug}:${scope ?? ''}`
}

async function globMany(rootDir: string, patterns: readonly string[]): Promise<string[]> {
  const results = new Set<string>()
  for (const pattern of patterns) {
    const glob = new (requireBun().Glob)(pattern)
    for await (const rel of glob.scan({ cwd: rootDir, absolute: false, onlyFiles: true })) {
      results.add(join(rootDir, rel))
    }
  }
  return Array.from(results).sort()
}

type Mutable<T> = { -readonly [P in keyof T]: T[P] }
