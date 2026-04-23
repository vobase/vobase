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
export { BUSINESS_MD_FALLBACK, buildFrozenEagerPaths, createWorkspace } from './create-workspace'
export {
  conversationVerbs,
  createVobaseCommand,
  driveVerbs,
  memoryVerbs,
  teamVerbs,
  type VobaseDispatcherOpts,
} from './vobase-cli'

/**
 * Build the per-wake read-only configuration for the virtual workspace.
 *
 * The template declares writable zones its modules depend on:
 *   - `/contacts/<id>/drive/` — contact upload space (direct write)
 *   - `/tmp/` — scratch (direct write)
 *
 * Memory files (`/agents/<id>/MEMORY.md`, `/contacts/<id>/MEMORY.md`) render
 * the `vobase memory …` hint on direct writes. Exact RO paths
 * (`/agents/<id>/AGENTS.md`, `/contacts/<id>/profile.md`) surface the standard
 * read-only error. Everything else defaults to RO per the core enforcer.
 */
export function buildDefaultReadOnlyConfig(ids: { agentId: string; contactId: string }): ReadOnlyConfig {
  return buildReadOnlyConfig({
    writablePrefixes: [`/contacts/${ids.contactId}/drive/`, '/tmp/'],
    memoryPaths: [`/agents/${ids.agentId}/MEMORY.md`, `/contacts/${ids.contactId}/MEMORY.md`],
    readOnlyExact: [`/agents/${ids.agentId}/AGENTS.md`, `/contacts/${ids.contactId}/profile.md`],
  })
}

/** Default writable prefixes for the per-wake config; excludes memory paths (those use the memory hint). */
export function buildDefaultWritablePrefixes(ids: { contactId: string }): readonly string[] {
  return [`/contacts/${ids.contactId}/drive/`, '/tmp/']
}
