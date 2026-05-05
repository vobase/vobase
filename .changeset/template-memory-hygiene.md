---
"@vobase/template": patch
---

# Memory hygiene: budget headers, capture triggers, scope conventions

Revamp how the agent harness instructs and budgets `MEMORY.md` across all three scopes (agent self / contact / staff).

**AGENTS.md additions** — three new sections compose into every wake's AGENTS.md:

- `agents.self-state` (priority 20, trimmed) — file locations only, no longer carries capture imperatives.
- `agents.memory-capture-triggers` (priority 25) — "## When to capture" with the auto-loop reframe (do NOT echo `internal_note_added` / supervisor coaching; the self-learn loop captures those automatically). Lists keywords (`always`, `never`, `from now on`, `remember that`, `next time`) for mid-wake self-lessons only.
- `agents.memory-conventions` (priority 26) — three-row scope table (agent / contact / staff) with paths, when-to-write, append + sed mutation patterns, and a 30-day prune rule.

**Per-wake budget header** — every materialized `MEMORY.md` gains a deterministic `<!-- memory-budget scope=... id=... chars=N (utf16) cap=8000 over=true|false -->` line as a soft visibility hint. Header is render-time only and `stripBudgetHeader` keeps storage clean (no header round-trip into the DB column on workspace-sync flush). Header surface is capped to the first 5 staff ids per wake (`STAFF_BUDGET_HEADER_CAP`); body materialization still iterates all `staffIds` so the workspace surface is unchanged.

**Self-learn loop fix** — `Note: —` empty-body bug in the `## Staff signal —` block that the `learning-proposals` observer appends. The supervisor wake's `agent_start` payload only carries `noteId`; the observer now looks up the body via `listNotes(conversationId)`, capped at 800 chars, so the captured rule actually surfaces in working memory.

**Determinism** — `wake/memory-budget.ts` is byte-pure (source-regex guard bans `Date`, `Math.random`, `process.env`, `os.hostname`, `__dirname`, etc.). Cross-wake `systemHash` stability test added to `wake/prompt.test.ts` covering all three scope headers reaching the rendered system prompt.

**Tests** — 79 passing across `wake/memory-budget.test.ts`, `wake/observers/workspace-sync.test.ts`, `wake/observers/learning-proposals.test.ts`, `modules/{agents,contacts,team}/agent.test.ts`, `wake/prompt.test.ts`, `wake/build-base.test.ts`. Live smoke verified the GK Corp regression bug (customer-volunteered facts now persist to `/contacts/<id>/MEMORY.md`).
