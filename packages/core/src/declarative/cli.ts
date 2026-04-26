/**
 * `bun run resources:export <kind> <slug> [--scope <s>] [--out <path>]`
 *
 * Promote a runtime-mutated declarative-resource row back to disk so it can
 * be checked in. Refuses file-origin rows — those are already byte-aligned
 * with the source tree, and a re-export would be a no-op (or worse, churn
 * whitespace). Returns the relative path the file was written to.
 *
 * The CLI itself is platform-agnostic: callers pass the db handle, root
 * directory, and a `writeFile` adapter. Templates wrap this with `Bun.write`
 * and a connected drizzle handle.
 */

import { relative, resolve } from 'node:path'
import { and, eq, sql } from 'drizzle-orm'
import type { AnyPgColumn, AnyPgTable } from 'drizzle-orm/pg-core'

import { getDeclarativeTable } from './boot'
import { getDeclarativeResource } from './define'
import type { Authored } from './types'

interface ExportCliCols {
  id: AnyPgColumn
  slug: AnyPgColumn
  scope: AnyPgColumn
}

export interface ExportCliDeps {
  // biome-ignore lint/complexity/noBannedTypes: matches the established cross-module Function-shape pattern
  db: { select: Function }
  rootDir: string
  writeFile: (absPath: string, content: string) => Promise<void>
}

export interface ExportCliResult {
  /** Path relative to `rootDir`. */
  relPath: string
  bytesWritten: number
}

export class ExportCliError extends Error {
  readonly code: 'unknown_kind' | 'unbound_table' | 'not_found' | 'origin_file' | 'no_target_path' | 'usage'
  constructor(code: ExportCliError['code'], message: string) {
    super(message)
    this.code = code
  }
}

export interface ExportCliOpts {
  kind: string
  slug: string
  scope?: string | null
  /** Destination override; when omitted, falls back to row.fileSourcePath. */
  out?: string
}

export async function runExportCli(deps: ExportCliDeps, opts: ExportCliOpts): Promise<ExportCliResult> {
  const resource = getDeclarativeResource(opts.kind)
  if (!resource) {
    throw new ExportCliError('unknown_kind', `unknown declarative-resource kind "${opts.kind}"`)
  }
  const table = getDeclarativeTable(opts.kind) as AnyPgTable | undefined
  if (!table) {
    throw new ExportCliError(
      'unbound_table',
      `kind "${opts.kind}" has no bound table — call bindDeclarativeTable() during module init`,
    )
  }

  const cols = table as unknown as ExportCliCols
  const scope = opts.scope ?? null
  const rows = (await deps.db
    .select()
    .from(table)
    .where(
      and(eq(cols.slug, opts.slug), scope === null ? sql`scope IS NULL` : eq(cols.scope, scope)),
    )) as Authored<unknown>[]

  const row = rows[0]
  if (!row) {
    const where = scope ? `slug=${opts.slug} scope=${scope}` : `slug=${opts.slug}`
    throw new ExportCliError('not_found', `no row found for kind=${opts.kind} ${where}`)
  }

  if (row.origin === 'file') {
    throw new ExportCliError(
      'origin_file',
      `row origin is 'file' — already in sync with disk (${row.fileSourcePath ?? '<unknown>'}). Edit the source file directly.`,
    )
  }

  const targetRel = opts.out ?? row.fileSourcePath
  if (!targetRel) {
    throw new ExportCliError('no_target_path', `row has no fileSourcePath; pass --out <path> to choose a destination`)
  }

  const targetAbs = resolve(deps.rootDir, targetRel)
  const content = resource.serialize(row.body)
  const bytes = new TextEncoder().encode(content).byteLength
  await deps.writeFile(targetAbs, content)
  return { relPath: relative(deps.rootDir, targetAbs), bytesWritten: bytes }
}

/**
 * Parse `[<kind>, <slug>, ...flags]` into an ExportCliOpts. Throws
 * ExportCliError('usage') on malformed input.
 */
export function parseExportArgv(argv: readonly string[]): ExportCliOpts {
  const positional: string[] = []
  let scope: string | null | undefined
  let out: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--scope') {
      scope = argv[++i] ?? ''
      continue
    }
    if (arg === '--out') {
      out = argv[++i]
      continue
    }
    if (arg?.startsWith('--')) {
      throw new ExportCliError('usage', `unknown flag "${arg}"`)
    }
    if (arg !== undefined) positional.push(arg)
  }
  const [kind, slug] = positional
  if (!kind || !slug) {
    throw new ExportCliError('usage', 'usage: resources:export <kind> <slug> [--scope <s>] [--out <path>]')
  }
  return { kind, slug, scope, out }
}
