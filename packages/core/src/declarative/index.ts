/**
 * Public surface for declarative-resources core primitives.
 *
 * The lifecycle: file in source → boot reconcile → DB row → runtime mutation
 * → optional export back to disk. See `types.ts` for the row shape and
 * `boot.ts` for the bootstrap entry point.
 */

export {
  __resetDeclarativeBindingsForTests,
  type BootDeclarativeResourcesOpts,
  type BootDeclarativeResourcesResult,
  bindDeclarativeTable,
  bootDeclarativeResources,
  getDeclarativeTable,
} from './boot'
export {
  type ExportCliDeps,
  ExportCliError,
  type ExportCliOpts,
  type ExportCliResult,
  parseExportArgv,
  runExportCli,
} from './cli'
export { type AuthoredColumnsOpts, authoredColumns, authoredConstraints } from './columns'
export {
  __resetDeclarativeRegistryForTests,
  type DefineDeclarativeResourceOpts,
  defineDeclarativeResource,
  getDeclarativeResource,
  listDeclarativeResources,
} from './define'
export {
  type AuditDriftDeps,
  type AuditDriftInput,
  classifyDrift,
  type DriftInput,
  type DriftOutcome,
  type RecordSimpleAuditInput,
  recordDriftConflict,
  recordReconcilerAudit,
} from './drift'
export {
  parseFileBytes,
  type RawParseResult,
  serializeMarkdownFrontmatter,
  serializeYaml,
} from './parse'
export {
  type ReconcileDeps,
  type ReconcileResourceArgs,
  type ReconcilerDb,
  reconcileResource,
} from './reconcile'
export {
  __resetRefGraphForTests,
  type BuildRefGraphDeps,
  buildRefGraph,
  listRefGraphContributors,
  type RefGraphContributor,
  type RefGraphResult,
  type ResourceRef,
  registerRefGraphContributor,
} from './refgraph'
export type {
  Authored,
  DeclarativeResource,
  Origin,
  ParsedFile,
  ParseFileContext,
  ReconcileDiff,
  ResourceFormat,
} from './types'
export {
  __resetViewablesForTests,
  defineViewable,
  getViewable,
  listViewables,
  type ViewableColumn,
  type ViewableColumnType,
  type ViewableConfig,
  type ViewableDefaultView,
  validateFilters,
} from './viewable'
