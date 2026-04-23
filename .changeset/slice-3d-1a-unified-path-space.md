---
"@vobase/core": minor
"@vobase/template-v2": minor
---

# Slice 3d.1a: unified path space + AGENTS.md composite

Drop the `/workspace/` prefix from every virtual-FS path. Agents now navigate a
unified namespace keyed by nanoid: `/agents/<agentId>/`, `/contacts/<contactId>/`,
`/conversations/<convId>/`, `/drive/`, `/tmp/`.

**AGENTS.md composite.** `generateAgentsMd({ agentName, agentId, commands, instructions })`
emits a title line `# <Name> (<id>)`, a framework preamble, the CLI command
reference, and an `## Instructions` section rendered verbatim from the agent
definition. No more separate `SOUL.md` / `TOOLS.md` / `bookings.md` files.

**`agent_definitions.soul_md` → `instructions`.** The column, TypeScript field,
Zod schema, API client types, seed constants, drive virtual-field overlay, and
the `/SOUL.md` virtual path all renamed in lockstep to `instructions` /
`/instructions.md`. Template is scaffolding — no dual-mode migration; wipe dev
data with `bun run db:reset`.

**Active-IDs preamble.** The frozen system prompt now opens with a structural
line identifying the wake scope. Conversational wakes emit
`"You are /agents/<agentId>/, working on /conversations/<convId>/ with contact /contacts/<contactId>/."`;
non-conversational wakes emit the agent-only form
`"You are /agents/<agentId>/."`. No empty-slot interpolation artifacts.

**Bash cwd.** The virtual shell starts at `/agents/<agentId>/` so relative
paths resolve to the agent's own home directory.

**Write-rules table.** Core's `buildReadOnlyConfig` now takes
`{ writablePrefixes, readOnlyExact?, memoryPaths?, readOnlyPrefixes? }`.
Core ships only `/drive/` as a default RO prefix; apps declare their writable
zones. Template's `buildDefaultReadOnlyConfig({ agentId, contactId })` wires
up `/contacts/<id>/drive/` + `/tmp/` as writable, `/agents/<id>/MEMORY.md` +
`/contacts/<id>/MEMORY.md` as memory-hint paths, and `/agents/<id>/AGENTS.md`
+ `/contacts/<id>/profile.md` as exact RO paths.
