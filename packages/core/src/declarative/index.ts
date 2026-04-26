/**
 * Public surface for declarative-resource primitives.
 *
 * Slice 1 of the `external-cli-and-collapse-shell` change collapsed the boot
 * reconciler (drift, refgraph, audit, export CLI, automatic boot scan).
 * What remains is the thin registry + parse/serialize plumbing; concrete
 * consumers are revisited in Slice 3 alongside `vobase install --defaults`.
 */

export {
  __resetDeclarativeBindingsForTests,
  bindDeclarativeTable,
  getDeclarativeTable,
} from './boot'
export { type AuthoredColumnsOpts, authoredColumns, authoredConstraints } from './columns'
export {
  type DefineDeclarativeResourceOpts,
  defineDeclarativeResource,
  getDeclarativeResource,
  listDeclarativeResources,
} from './define'
export {
  parseFileBytes,
  type RawParseResult,
  serializeMarkdownFrontmatter,
  serializeYaml,
} from './parse'
export type {
  Authored,
  DeclarativeResource,
  Origin,
  ParsedFile,
  ParseFileContext,
  ResourceFormat,
} from './types'
