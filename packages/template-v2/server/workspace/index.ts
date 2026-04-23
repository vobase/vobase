export {
  checkWriteAllowed,
  type DirtyDiff,
  DirtyTracker,
  type GenerateAgentsMdOpts,
  generateAgentsMd,
  isWritablePath,
  MaterializerRegistry,
  ReadOnlyFsError,
  ScopedFs,
  snapshotFs,
  WRITABLE_PREFIXES,
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
