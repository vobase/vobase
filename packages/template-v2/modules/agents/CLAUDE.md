## modules/agents/

Last in the init chain (depends on inbox/contacts/drive ports). Owns the `conversation_events` journal — the single append-only observability substrate. `server/harness/` drives the wake loop; this module supplies the domain services (definitions, journal, scheduler, proposals, cost) the harness calls into.

**Journal is the ONLY caller to `conversation_events`.** `service/journal.ts` is the sole writer (one-write-path discipline). Every `AgentEvent` lands here in the same transaction as the domain write it co-commits.

**Five wake triggers** — `inbound_message | approval_resumed | supervisor | scheduled_followup | manual`. Adding a new trigger means adding a `WakeTrigger` variant in `server/contracts/event.ts` and handling it in `__checks__/integration.ts`.

**Observer registration order matters** (earlier runs first per dispatch): audit → sse → workspaceSync → scorer → memoryDistill → learningProposal → costAggregator. `costAggregator` is the sole writer to `tenant_cost_daily`.

**Mutator order** (first `block` wins): moderation → approval. Moderation is env-gated (`VOBASE_ENABLE_MODERATION=true`) so Phase-2 fixture replays stay deterministic.

**Tiered learning flow.** Staff consult-replies, supervisor notes, and approval rejections are concentrated teaching signals. `learningProposalObserver` runs after any wake containing these and proposes durable changes:
- Low blast-radius (contact memory, agent memory) → auto-write.
- High blast-radius (skill files, tenant drive docs) → `learning_proposals` row, staff approves via the learnings UI.
- Rejections store as anti-lessons in the agent memory so the agent doesn't re-propose.

**`active_wakes` is UNLOGGED.** In-flight guard preventing duplicate concurrent wakes. Doesn't survive crash — wake-worker reconciles on restart via `restart-recovery`.

**Subagent depth limit = 1.** `tools/subagent.ts` runs a restricted-toolset child agent. No nested subagents — deeper recursion is off-spec.
