---
'@vobase/core': minor
'@vobase/template-v2': minor
---

Move harness persistence from template-v2 to `@vobase/core` under a new `harness` pgSchema.

Six tables now ship from core: `conversation_events`, `active_wakes`, `threads`, `messages`
(agent-thread payloads), `tenant_cost_daily`, and `audit_wake_map`. The matching services —
`journal` (sole writer of `conversation_events`), `cost` (sole writer of `tenant_cost_daily`),
`message-history` (thread + pi AgentMessage load/save), and `wake-registry` (renamed from
`active-wakes`) — are now imported from `@vobase/core`. Template-v2 keeps domain tables
(`agent_definitions`, `learned_skills`, `learning_proposals`, `agent_scores`) in its `agents`
schema; cross-schema FKs (`harness.threads.agent_id → agents.agent_definitions`,
`agents.learning_proposals.wake_event_id → harness.conversation_events`) are enforced by
`db-apply-extras`.
