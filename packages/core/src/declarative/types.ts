/**
 * Shared types for the declarative-resource lifecycle.
 *
 * The lifecycle: a file in source (yaml or markdown-frontmatter) is read at
 * boot, hashed, and upserted into a database row that conforms to the
 * `Authored<T>` shape. Once a row exists, it can be mutated at runtime by a
 * user or an agent — those edits flip `origin` away from `'file'` and the
 * reconciler stops trying to re-seed from the file. Drift between file and
 * row is recorded as a `reconciler_audit` row, never silently overwritten.
 *
 * Concrete consumers (saved_views, agent_skills, agent_definitions, …) bring
 * their own Drizzle table that includes the standard `Authored<T>` columns
 * (helpers in `./columns.ts`) plus a JSONB `body` whose shape they validate
 * with a Zod schema declared on the resource definition.
 */

import type { z } from 'zod'

/**
 * Where the current row content originated.
 *
 * - `'file'`  : last write came from boot reconcile from disk; the row is in
 *               sync with `fileSourcePath` at hash `fileContentHash`.
 * - `'user'`  : last write came from a UI mutation (e.g. "Save view"). The
 *               reconciler must NOT clobber `body` from disk.
 * - `'agent'` : last write came from an agent tool (`save_view`, `memory set`).
 *               Same protection as `'user'`.
 */
export type Origin = 'file' | 'user' | 'agent'

/** The standard column shape every declarative-resource row carries. */
export interface Authored<TBody> {
  readonly id: string
  readonly slug: string
  readonly scope: string | null
  readonly body: TBody
  readonly origin: Origin
  readonly fileSourcePath: string | null
  readonly fileContentHash: string | null
  readonly ownerStaffId: string | null
  readonly active: boolean
  readonly createdAt: Date
  readonly updatedAt: Date
}

/** File-format encodings the reconciler knows how to parse / serialize. */
export type ResourceFormat = 'yaml' | 'markdown-frontmatter'

export interface ParsedFile<TBody> {
  /** Stable identifier within `scope`. Defaults to the filename without extension. */
  slug: string
  /** Optional partition (e.g. `object:contacts` for a saved view). Null for global. */
  scope: string | null
  /** Validated body. */
  body: TBody
}

/** Result of a single reconciler pass over a resource's source files. */
export interface ReconcileDiff {
  readonly kind: string
  readonly inserted: number
  readonly updated: number
  readonly skipped: number
  readonly tombstoned: number
  readonly conflicts: number
}

export interface ParseFileContext {
  /** Absolute path on disk. */
  filePath: string
  /** Path relative to the reconciler's `rootDir`. */
  relPath: string
  /** Filename without extension; the default slug. */
  basename: string
  /** Immediate parent directory name (useful for inferring scope). */
  parentDir: string
}

/**
 * A registered declarative-resource type. Created by `defineDeclarativeResource`,
 * read by the reconciler driver. Generic over the body shape so consumers stay
 * type-safe end-to-end.
 */
export interface DeclarativeResource<TBody> {
  readonly kind: string
  readonly sourceGlobs: readonly string[]
  readonly format: ResourceFormat
  readonly bodySchema: z.ZodType<TBody>
  /**
   * Optional path → (slug, scope) extractor. Default: `slug = basename`,
   * `scope = parentDir` if the parent directory looks like a scope token
   * (contains a `:` or is `views/` style), else `null`.
   */
  readonly parsePath?: (ctx: ParseFileContext) => { slug: string; scope: string | null }
  /** Serialize a body back to file bytes. Inverse of the format parser. */
  readonly serialize: (body: TBody) => string
}
