---
'@vobase/template-v2': minor
---

Trigger-driven capabilities + supervisor mention fan-out.

Slice 1 — `@AgentName` in internal notes wakes the right agent.
- `WakeTrigger.supervisor` widens with optional `mentionedAgentId?: string`. The
  assignee self-wake variant leaves it undefined; peer wakes carry the
  mentioned agent's id and boot via that agent's own builder lane (Principle 1:
  identity on the agent, capability on the trigger).
- New `modules/messaging/service/agent-mentions.ts` resolver — staff-authored
  notes only (HARD ping-pong filter — Risk #1). Reuses the longest-name +
  word-boundary scanner from `messaging/components/mentions.ts`. Filters on
  `agent_definitions.enabled = true` scoped by organization. Composer
  `mentions[]`, when supplied, is intersected.
- `notes.addNote` becomes a wake-spawn site (joining `pending-approvals.decide`).
  Post-commit fan-out: assignee self-wake (no `mentionedAgentId`) plus one peer
  wake per distinct mentioned agent (suppressing self-mention duplicates).
  Each enqueue is best-effort — fan-out failure never rolls back the note.
- New `MESSAGING_SUPERVISOR_TO_WAKE_JOB` (`messaging:supervisor-to-wake`) +
  `createSupervisorWakeHandler`, registered in `runtime/bootstrap.ts` alongside
  the existing inbound + operator wake handlers. pg-boss singletonKey is
  `supervisor:<convId>:<noteId>:<mentionedAgentId ?? 'self'>`.
- `wake/build-config/concierge.ts` accepts an optional `triggerOverride` so the
  supervisor wake reuses the concierge builder without forking. The trigger
  renderer's `case 'supervisor'` now branches on `mentionedAgentId` to produce
  a "Staff @-mentioned you" cue when set; renderer remains a pure function of
  `(trigger, refs)` (Risk #2 mitigation — frozen-snapshot stability).
- Partial composite index on `agent_definitions(organization_id) WHERE
  enabled = true` keeps the per-note resolver O(log n) as agent counts grow.

Slice 2 — Capability registry skeleton (no behaviour change).
- New `modules/agents/wake/capability.ts` exporting `Capability` and
  `resolveCapability(triggerKind: WakeTriggerKind): Capability`. Two registered
  lanes: concierge (`inbound_message | supervisor | approval_resumed |
  scheduled_followup | manual`) and operator (`operator_thread | heartbeat`).
- Both `wake/build-config/concierge.ts` and `wake/build-config/operator.ts`
  consume the registry for tools + log prefix. `systemHash` is byte-identical
  before/after the refactor.

Slice 3 — Drop `agent_definitions.role`.
- Schema column + `agent_definitions_role_check` constraint removed. The
  template's `AgentRole` type is gone.
- `seed.ts` no longer writes `role:`. Capability lane selection is now driven
  exclusively by trigger kind via the Slice-2 registry — no production code
  path reads `agent_definitions.role`.
- `bun run db:reset` is the single-tx migration path (template is
  scaffolding — drop+recreate, no dual-mode). The unrelated
  `packages/core/src/workspace/cli/dispatcher.ts` `type AgentRole = string`
  remains untouched.
