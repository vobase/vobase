import { buildReadOnlyConfig, type ReadOnlyConfig, type RoHintFn } from '@vobase/core'

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

export type { CreateWorkspaceOpts, WorkspaceHandle, WorkspaceLane } from './create'
export { createWorkspace } from './create'

/**
 * Compose a `RoMessageOverride` from per-module `roHints` collected via
 * `AgentContributions.roHints`. Each hint returns either a recovery message
 * for paths it owns or `null` to fall through to the next; first non-null
 * wins. With no hints, returns `null` (the harness falls back to its
 * generic RO error). Pure — no side effects, no module-level state.
 */
export function chainRoHints(hints: readonly RoHintFn[]): RoHintFn {
  return (path) => {
    for (const fn of hints) {
      const out = fn(path)
      if (out != null) return out
    }
    return null
  }
}

/**
 * Build the per-wake read-only configuration for the virtual workspace.
 *
 * MEMORY.md files (`/agents/<id>/MEMORY.md`, `/contacts/<id>/MEMORY.md`) are
 * direct-writable like any other markdown file — agents edit them with `cat`,
 * `echo >>`, `sed`, or heredocs. Persistence happens at `agent_end` via the
 * workspace-sync listener (which classifies the dirty paths and flushes them
 * through `drive.writePath`). Staff-scope MEMORY.md remains gated through the
 * staff-memory service since it has no `/staff/<id>/drive/` mirror.
 *
 * Writable zones:
 *   - `/agents/<agentId>/MEMORY.md` and `/agents/<agentId>/skills/` — agent's own state
 *   - `/contacts/<contactId>/MEMORY.md` and `/contacts/<contactId>/drive/` — contact mutable space
 *   - `/staff/<staffId>/MEMORY.md` — per-(agent, staff) memory (direct-writable; flushed via workspace-sync observer)
 *   - `/tmp/` — scratch
 *
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
 */
export function buildStandaloneReadOnlyConfig(ids: {
  agentId: string
  staffIds?: readonly string[]
  /** Per-module RO-error hints; chained left-to-right by `chainRoHints`. */
  roHints?: readonly RoHintFn[]
}): ReadOnlyConfig {
  const staffIds = ids.staffIds ?? []
  const readOnlyExact: string[] = [
    `/agents/${ids.agentId}/AGENTS.md`,
    '/INDEX.md',
    ...staffIds.map((s) => `/staff/${s}/profile.md`),
  ]
  return buildReadOnlyConfig({
    // Trailing-slash trick: a `writablePrefix` of `<path>/` matches both the
    // exact `<path>` (via `prefix.slice(0,-1)`) and any `<path>/...` descendant.
    // For an exact-file allow we want only the first match, but since MEMORY.md
    // has no children the second arm is dead. This encoding is what both
    // `checkWriteAllowed` AND the dirty-tracker's `isWritablePath` understand —
    // `writableGlobs` is enforcer-only and would silently drop the dirt diff.
    writablePrefixes: [`/agents/${ids.agentId}/skills/`, `/agents/${ids.agentId}/MEMORY.md/`, '/tmp/'],
    memoryPaths: staffIds.map((s) => `/staff/${s}/MEMORY.md`),
    readOnlyExact,
    roMessageOverride: ids.roHints ? chainRoHints(ids.roHints) : undefined,
  })
}

export function buildDefaultReadOnlyConfig(ids: {
  agentId: string
  contactId: string
  channelInstanceId: string
  staffIds?: readonly string[]
  /** Per-module RO-error hints; chained left-to-right by `chainRoHints`. */
  roHints?: readonly RoHintFn[]
}): ReadOnlyConfig {
  const staffIds = ids.staffIds ?? []
  const readOnlyExact: string[] = [
    `/agents/${ids.agentId}/AGENTS.md`,
    `/contacts/${ids.contactId}/profile.md`,
    `/contacts/${ids.contactId}/${ids.channelInstanceId}/messages.md`,
    `/contacts/${ids.contactId}/${ids.channelInstanceId}/internal-notes.md`,
    ...staffIds.map((s) => `/staff/${s}/profile.md`),
  ]
  return buildReadOnlyConfig({
    // See `buildStandaloneReadOnlyConfig` for the trailing-slash trick rationale.
    writablePrefixes: [
      `/contacts/${ids.contactId}/drive/`,
      `/agents/${ids.agentId}/MEMORY.md/`,
      `/contacts/${ids.contactId}/MEMORY.md/`,
      '/tmp/',
    ],
    memoryPaths: staffIds.map((s) => `/staff/${s}/MEMORY.md`),
    readOnlyExact,
    roMessageOverride: ids.roHints ? chainRoHints(ids.roHints) : undefined,
  })
}
