import { buildReadOnlyConfig, type ReadOnlyConfig } from '@vobase/core'

import { helpdeskRoMessage } from './helpdesk-header'

export { BUSINESS_MD_FALLBACK } from '@modules/drive/agent'
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

export {
  conversationVerbs,
  createVobaseCommand,
  driveVerbs,
  memoryVerbs,
  teamVerbs,
  type VobaseDispatcherOpts,
} from './cli'
export type { CreateStandaloneWorkspaceOpts } from './create-standalone-workspace'
export { createStandaloneWorkspace } from './create-standalone-workspace'
export type { CreateWorkspaceOpts, WorkspaceHandle } from './create-workspace'
export { createWorkspace } from './create-workspace'
export { HELPDESK_AGENTS_MD_HEADER, helpdeskRoMessage } from './helpdesk-header'

/**
 * Build the per-wake read-only configuration for the virtual workspace.
 *
 * The template declares writable zones its modules depend on:
 *   - `/contacts/<id>/drive/` — contact upload space (direct write)
 *   - `/tmp/` — scratch (direct write)
 *
 * Memory files (`/agents/<id>/MEMORY.md`, `/contacts/<id>/MEMORY.md`,
 * `/staff/<id>/MEMORY.md`) render the `vobase memory …` hint on direct writes.
 * Exact RO paths (`/agents/<id>/AGENTS.md`, `/contacts/<id>/profile.md`,
 * `/contacts/<id>/<channelInstanceId>/messages.md` + `/internal-notes.md`,
 * `/staff/<id>/profile.md`) surface the standard read-only error. Everything
 * else defaults to RO per the core enforcer.
 */
/**
 * Build the standalone-lane read-only configuration. Standalone wakes survey
 * the whole org and write only to their own working space — direct writes to a
 * contact's MEMORY/profile are conversation-lane-only (standalone wakes propose
 * changes via tools like `update_contact` instead).
 *
 * Writable: `/agents/<id>/MEMORY.md` (memory), `/agents/<id>/skills/`,
 * `/tmp/`. Everything else (including `/contacts/**`, `/drive/**`,
 * `/INDEX.md`, `/staff/**`) is RO under the default-deny enforcer.
 *
 * `staffIds` lets the staff-profile RO list interpolate per-staff paths so
 * `vobase memory` hints render correctly when a standalone agent reads them.
 */
export function buildStandaloneReadOnlyConfig(ids: { agentId: string; staffIds?: readonly string[] }): ReadOnlyConfig {
  const staffIds = ids.staffIds ?? []
  const memoryPaths: string[] = [`/agents/${ids.agentId}/MEMORY.md`]
  const readOnlyExact: string[] = [
    `/agents/${ids.agentId}/AGENTS.md`,
    '/INDEX.md',
    ...staffIds.map((s) => `/staff/${s}/profile.md`),
  ]
  return buildReadOnlyConfig({
    writablePrefixes: [`/agents/${ids.agentId}/skills/`, '/tmp/'],
    memoryPaths,
    readOnlyExact,
    roMessageOverride: helpdeskRoMessage,
  })
}

export function buildDefaultReadOnlyConfig(ids: {
  agentId: string
  contactId: string
  channelInstanceId: string
  staffIds?: readonly string[]
}): ReadOnlyConfig {
  const staffIds = ids.staffIds ?? []
  const memoryPaths: string[] = [
    `/agents/${ids.agentId}/MEMORY.md`,
    `/contacts/${ids.contactId}/MEMORY.md`,
    ...staffIds.map((s) => `/staff/${s}/MEMORY.md`),
  ]
  const readOnlyExact: string[] = [
    `/agents/${ids.agentId}/AGENTS.md`,
    `/contacts/${ids.contactId}/profile.md`,
    `/contacts/${ids.contactId}/${ids.channelInstanceId}/messages.md`,
    `/contacts/${ids.contactId}/${ids.channelInstanceId}/internal-notes.md`,
    ...staffIds.map((s) => `/staff/${s}/profile.md`),
  ]
  return buildReadOnlyConfig({
    writablePrefixes: [`/contacts/${ids.contactId}/drive/`, '/tmp/'],
    memoryPaths,
    readOnlyExact,
    roMessageOverride: helpdeskRoMessage,
  })
}
