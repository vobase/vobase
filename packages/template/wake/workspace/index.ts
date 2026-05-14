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
 * Built-in RO hint for PROFILE.md paths. Contact PROFILE.md gets the verb
 * recovery message; staff PROFILE.md (no CLI verb yet) gets the fallback
 * `update_contact` / escalate guidance. Returns `null` for non-PROFILE.md
 * paths so the chain falls through to per-module hints.
 */
const PROFILE_HINT: RoHintFn = (path) => {
  if (/^\/contacts\/[^/]+\/PROFILE\.md$/.test(path)) {
    const id = path.split('/')[2]
    return [
      `bash: ${path}: Read-only filesystem.`,
      `  PROFILE.md is structured-edit only — propose changes via \`vobase contacts propose-change --id ${id} --field <name> --to "<value>" --rationale "<why>"\`.`,
    ].join('\n')
  }
  if (/^\/staff\/[^/]+\/PROFILE\.md$/.test(path)) {
    return [
      `bash: ${path}: Read-only filesystem.`,
      '  Staff PROFILE.md edits are not yet plumbed through a CLI verb; if you need to update a staff record, use `update_contact` (operator lane) or escalate.',
    ].join('\n')
  }
  return null
}

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
    ...staffIds.map((s) => `/staff/${s}/PROFILE.md`),
  ]
  const builtinHints: readonly RoHintFn[] = [PROFILE_HINT]
  const moduleHints = ids.roHints ?? []
  return buildReadOnlyConfig({
    // Trailing-slash trick: a `writablePrefix` of `<path>/` matches both the
    // exact `<path>` (via `prefix.slice(0,-1)`) and any `<path>/...` descendant.
    // For an exact-file allow we want only the first match, but since MEMORY.md
    // has no children the second arm is dead. This encoding is what both
    // `checkWriteAllowed` AND the dirty-tracker's `isWritablePath` understand —
    // `writableGlobs` is enforcer-only and would silently drop the dirt diff.
    writablePrefixes: [`/agents/${ids.agentId}/skills/`, `/agents/${ids.agentId}/MEMORY.md/`, '/tmp/'],
    // Single-file writable allowances: per-staff MEMORY.md (staff PROFILE.md
    // is RO — edits aren't plumbed through a CLI verb yet).
    memoryPaths: staffIds.map((s) => `/staff/${s}/MEMORY.md`),
    readOnlyExact,
    roMessageOverride: chainRoHints([...builtinHints, ...moduleHints]),
  })
}

/**
 * Build the per-wake read-only configuration for the virtual workspace.
 *
 * MEMORY.md files (`/agents/<id>/MEMORY.md`, `/contacts/<id>/MEMORY.md`,
 * `/staff/<id>/MEMORY.md`) are direct-writable — agents edit them with `cat`,
 * `echo >>`, `sed`, or heredocs. Persistence happens at `agent_end` via the
 * workspace-sync listener (which classifies the dirty paths and flushes them
 * through `drive.writePath`). Staff-scope MEMORY.md remains gated through the
 * staff-memory service since it has no `/staff/<id>/drive/` mirror.
 *
 * PROFILE.md files (`/contacts/<id>/PROFILE.md`, `/staff/<id>/PROFILE.md`) are
 * RO. Customer-asked profile edits go through the `vobase contacts propose-change`
 * CLI verb (see AGENTS.md `## Contact context`); the verb routes the edit
 * through the change-proposals pipeline so gated fields queue for staff review
 * and non-gated fields auto-apply with full audit history.
 *
 * Writable zones:
 *   - `/agents/<agentId>/MEMORY.md` and `/agents/<agentId>/skills/` — agent's own state
 *   - `/contacts/<contactId>/MEMORY.md` and `/contacts/<contactId>/drive/` — contact mutable space
 *   - `/staff/<staffId>/MEMORY.md` — per-(agent, staff) memory (direct-writable; flushed via workspace-sync observer)
 *   - `/tmp/` — scratch
 *
 * Exact RO paths (`/agents/<id>/AGENTS.md`, `/contacts/<id>/PROFILE.md`,
 * `/contacts/<id>/<channelInstanceId>/CONVERSATION.md`, `/staff/<id>/PROFILE.md`)
 * surface the standard read-only error or the PROFILE.md verb hint. Everything
 * else defaults to RO per the core enforcer.
 */
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
    `/contacts/${ids.contactId}/${ids.channelInstanceId}/CONVERSATION.md`,
    `/contacts/${ids.contactId}/PROFILE.md`,
    ...staffIds.map((s) => `/staff/${s}/PROFILE.md`),
  ]
  const builtinHints: readonly RoHintFn[] = [PROFILE_HINT]
  const moduleHints = ids.roHints ?? []
  return buildReadOnlyConfig({
    // See `buildStandaloneReadOnlyConfig` for the trailing-slash trick rationale.
    writablePrefixes: [
      `/contacts/${ids.contactId}/drive/`,
      `/agents/${ids.agentId}/MEMORY.md/`,
      `/contacts/${ids.contactId}/MEMORY.md/`,
      '/tmp/',
    ],
    // Single-file writable allowances: per-staff MEMORY.md only (PROFILE.md is
    // RO — frontmatter edits route through `vobase contacts propose-change`).
    memoryPaths: staffIds.map((s) => `/staff/${s}/MEMORY.md`),
    readOnlyExact,
    roMessageOverride: chainRoHints([...builtinHints, ...moduleHints]),
  })
}
