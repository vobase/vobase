/**
 * Bun-free schema-helper barrel for `@vobase/core/schema`.
 *
 * `drizzle-kit` runs under Node and cannot resolve `'bun'`, so any module
 * loaded into a drizzle schema graph must avoid the full `@vobase/core`
 * barrel (which pulls Bun-only adapters like `s3.ts`). Module schema files
 * import column helpers from here instead.
 */

export {
  type AuthoredColumnsOpts,
  authoredColumns,
  authoredConstraints,
} from '../declarative/columns'
export {
  createNanoid,
  DEFAULT_COLUMNS,
  NANOID_ALPHABET,
  NANOID_LENGTH,
  nanoidPrimaryKey,
} from './helpers'
