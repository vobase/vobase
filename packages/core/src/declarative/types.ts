/**
 * Shared types for the declarative-resource lifecycle.
 *
 * Slice 1 of the `external-cli-and-collapse-shell` change collapsed the
 * boot-time reconciler. What remains is a thin registry primitive: a
 * declarative resource describes how to parse a body from a file (yaml or
 * markdown-frontmatter) and how to serialize it back. Concrete consumers
 * (skills, agent definitions, channel templates) are revisited in Slice 3
 * once `vobase install --defaults` lands.
 *
 * `Authored<T>` is the still-supported shape for any table that wants to
 * record provenance — `origin` is preserved for trace value; the file-source
 * tracking columns from the prior reconciler are gone.
 */

import type { z } from 'zod'

/**
 * Where the current row content originated.
 *
 * - `'file'`  : last write came from a `vobase install --defaults` pass.
 * - `'user'`  : last write came from a UI mutation.
 * - `'agent'` : last write came from an agent tool.
 */
export type Origin = 'file' | 'user' | 'agent'

/** The standard column shape every declarative-resource row carries. */
export interface Authored<TBody> {
  readonly id: string
  readonly slug: string
  readonly scope: string | null
  readonly body: TBody
  readonly origin: Origin
  readonly ownerStaffId: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

/** File-format encodings the parser knows how to decode / encode. */
export type ResourceFormat = 'yaml' | 'markdown-frontmatter'

export interface ParsedFile<TBody> {
  /** Stable identifier within `scope`. Defaults to the filename without extension. */
  slug: string
  /** Optional partition (e.g. `object:contacts`). Null for global. */
  scope: string | null
  /** Validated body. */
  body: TBody
}

export interface ParseFileContext {
  /** Absolute path on disk. */
  filePath: string
  /** Path relative to the install root. */
  relPath: string
  /** Filename without extension; the default slug. */
  basename: string
  /** Immediate parent directory name (useful for inferring scope). */
  parentDir: string
}

/**
 * A registered declarative-resource type. Created by `defineDeclarativeResource`.
 * Consumers are reintroduced in Slice 3.
 */
export interface DeclarativeResource<TBody> {
  readonly kind: string
  readonly sourceGlobs: readonly string[]
  readonly format: ResourceFormat
  readonly bodySchema: z.ZodType<TBody>
  readonly parsePath?: (ctx: ParseFileContext) => { slug: string; scope: string | null }
  readonly serialize: (body: TBody) => string
}
