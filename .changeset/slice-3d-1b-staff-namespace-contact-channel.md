---
"@vobase/template-v2": minor
"@vobase/core": minor
---

# Slice 3d.1b — `/staff/<id>/` namespace + `/contacts/<id>/<channelInstanceId>/` restructure

Second half of the unified path-space refactor. Follow-up to 3d.1a; breaking for
any downstream consumer (none exist outside this repo).

## Added

- **`agents.agent_staff_memory` table** — per-`(organization, agent, staff)`
  markdown blob with `UNIQUE (organization_id, agent_id, staff_id)` and an
  ON-DELETE-CASCADE FK to `agents.agent_definitions.id`. Backs the new
  `/staff/<staffId>/MEMORY.md` materializer.
- **`/staff/<staffId>/` namespace** — two new materializers:
  - `profile.md` (RO) — composed from `auth.user` + `team.staff_profiles`.
    First line is `# <Display Name> (<staffId>)` (identity-in-contents).
  - `MEMORY.md` (agent-writable) — backed by `agent_staff_memory`, read via
    `readStaffMemory`, written via `upsertStaffMemory` on `agent_end`.
- **`ScopedDiff.staffMemory`** — new `Map<staffId, DirtyDiff>` bucket on the
  core dirty-tracker. `/staff/<id>/MEMORY.md` writes classify into their own
  keyed bucket so the workspace-sync observer can upsert per staff.
- **`buildStaffMaterializers({ organizationId, agentId, staffIds, authLookup })`**
  — template helper that emits the profile + memory materializer pair for a
  set of staff ids, scoped to the active agent.

## Changed

- **`/conversations/<convId>/` → `/contacts/<contactId>/<channelInstanceId>/`**
  for messages.md and internal-notes.md. The `conversations` table and its
  `conversationId` column remain unchanged — the id survives as a DB key only,
  not a path segment.
- **`buildFrozenEagerPaths({ agentId, contactId, channelInstanceId })`** — signature
  change (was `conversationId`).
- **`CreateWorkspaceOpts.channelInstanceId`** — now required.
- **`FrozenPromptInput.channelInstanceId`** — replaces `conversationId`; the
  frozen system prompt's `# System` block emits `channel_instance_id=...` in
  place of `conversation_id=...`.
- **Active-IDs preamble — final form:**
  - Conversational: `"You are /agents/<agentId>/, conversing with /contacts/<contactId>/ via /contacts/<contactId>/<channelInstanceId>/. Latest at /contacts/<contactId>/<channelInstanceId>/messages.md."`
  - Non-conversational: `"You are /agents/<agentId>/."` (unchanged).
- **`buildDefaultReadOnlyConfig`** — now takes `channelInstanceId` + optional
  `staffIds`. Adds RO-exact entries for `/contacts/<id>/<channelInstanceId>/
  messages.md`, `/contacts/<id>/<channelInstanceId>/internal-notes.md`, and
  `/staff/<id>/profile.md`; adds memory-hint paths for `/staff/<id>/MEMORY.md`.
- **`RUNTIME_OWNED_PATHS`** — dropped `/conversations/` prefix entry; added
  `/staff/` prefix entry.
- **Contact `profile.md` fallback renderer** — first line is now
  `# <name-or-identifier> (<contactId>)` with identifier fallback order
  `displayName → phone → email → contactId` (identity-in-contents).
- **`renderTriggerMessage`** — now closes over `{ contactId, channelInstanceId }`
  and references the new `/contacts/<id>/<channelInstanceId>/` folder in
  `inbound_message` + `supervisor` trigger messages.
- **`WorkspaceSyncOpts`** — gains `organizationId` + `agentId` so the observer
  can dispatch staff-memory diffs through `upsertStaffMemory`.

## Removed

- All `/conversations/<convId>/` path-string references from workspace/harness
  code paths (grep clean in `packages/core/src`,
  `packages/template-v2/server/workspace`, and
  `packages/template-v2/server/harness`).

## Migration

- Scaffolding-grade: `bun run db:push` creates the `agent_staff_memory` table.
  No data migration; no dual-mode shims; no backward-compat path translation.
