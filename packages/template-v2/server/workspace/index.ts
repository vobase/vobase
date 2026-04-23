import { buildReadOnlyConfig, type ReadOnlyConfig } from '@vobase/core'

export {
  type BuildReadOnlyConfigOpts,
  buildReadOnlyConfig,
  checkWriteAllowed,
  type DirtyDiff,
  DirtyTracker,
  type GenerateAgentsMdOpts,
  generateAgentsMd,
  isWritablePath,
  MaterializerRegistry,
  type ReadOnlyConfig,
  ReadOnlyFsError,
  ScopedFs,
  snapshotFs,
} from '@vobase/core'
export type { CreateWorkspaceOpts, WorkspaceHandle } from './create-workspace'
export { BUSINESS_MD_FALLBACK, createWorkspace } from './create-workspace'
export {
  conversationVerbs,
  createVobaseCommand,
  driveVerbs,
  memoryVerbs,
  teamVerbs,
  type VobaseDispatcherOpts,
} from './vobase-cli'

/**
 * Template-level default list of writable workspace zones. Core no longer ships
 * a default — apps declare the zones their modules depend on. Drive uploads
 * (`contact/drive/**`) and scratch (`tmp/**`) are the two zones every vobase
 * template ships with.
 */
export const DEFAULT_WRITABLE_PREFIXES: readonly string[] = ['/workspace/contact/drive/', '/workspace/tmp/']

/** Pre-built read-only config using the template defaults. */
export const DEFAULT_READ_ONLY_CONFIG: ReadOnlyConfig = buildReadOnlyConfig({
  writablePrefixes: DEFAULT_WRITABLE_PREFIXES,
})
