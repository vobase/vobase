---
"@vobase/template": minor
---

# Changes module: history audit log + self-learn observer

The changes module previously only surfaced **pending** proposals. Once a staff reviewer approved or rejected one, the row simply vanished — no audit log, no "applied to /policies/refunds.md" feedback, no way to answer "who decided this and when?". And the self-learn loop was incomplete: `detectStaffSignals` was implemented and tested but no observer ever invoked it, so a staff `@`-mention or reply triggered a supervisor wake without ever turning into a memory entry the next wake could see.

## What changed

### `/changes` — Pending | History tabs

A new `<Tabs>` shell on `/changes` with URL-state via `validateSearch({ tab: z.enum(['pending','history']).optional() })`. The Pending tab keeps the existing FilterChip + ProposalRow grid. History adds:

- Day-grouped sticky headers (TUE 5 MAY · MON 4 MAY · …)
- Status filter chips: All / Approved / Rejected / Auto-applied
- Compact `<HistoryRow>` per decision with status badge, proposer + decider principals, headline target, and an expandable Problem / Outcome / Diff / decision-note panel
- Live-updates via the existing realtime SSE invalidation; no polling

### `GET /api/changes/history`

New route on the changes module, gated by `requireOrganization`. Query params: `resourceModule?`, `status?` (any `ChangeStatus | 'all'`), `limit?` (1–500, default 100). Backed by `listDecided(organizationId, opts)` on `ChangeProposalsService` — returns proposals where `status IN ('approved','rejected','auto_written','superseded')` ordered by `COALESCE(decided_at, created_at) DESC`, with the same conversation→contactId join as the inbox so rows can render a clickable contact pill.

### Approve / reject feedback

`<ProposalRow>` now fires a sonner toast on success: **"Change applied · `<resource>` updated · View in history"** for approve, **"Change rejected · Logged to history · View in history"** for reject. The action button navigates to `/changes?tab=history`. Approve/reject buttons disable when no authenticated user is present so the audit trail can never contain a fabricated principal — the previously-shipped `'staff:current'` literal fallback is gone.

### Self-learn loop closed

New `wake/observers/learning-proposals.ts` wired into both `wake/conversation.ts` and `wake/standalone.ts`. At `agent_end` it runs `detectStaffSignals` on the per-wake event buffer and, for each non-trivial signal (supervisor / approval-rejected / internal-note from a staff author — `reassignment_note` is intentionally skipped because the agent never saw it), files an `auto_written` proposal on `agents:agent_memory` with a structured markdown-append body capturing author + ref + note preview. Because `agent_memory` is registered with `requiresApproval: false`, the proposal materializes immediately and lands in History as audit — no staff click required, but every learning is reviewable after the fact.

The observer only buffers `agent_start` / `internal_note_added` / `agent_end` events (not `message_update` / `llm_call` / `tool_*` — hundreds per turn) and cleans its buffer on `agent_aborted` to prevent leaks on aborted wakes. Duplicate-pending conflicts are swallowed; everything else surfaces via `logger.error`.

### Service correctness

`insertProposal`'s duplicate-pending check is now scoped to pending-status inserts only. Auto-writes (`requiresApproval: false`) used to fail when an unrelated `pending` row existed on the same target — they now insert cleanly because the partial unique index only covers pending rows anyway.

### Smaller cleanups

- Centralized `CHANGE_STATUS_VALUES` const-tuple in `modules/changes/schema.ts` so handlers + hooks share one source of truth instead of inlining the union
- `or(...statuses.map(eq))` → `inArray(status, …)` in `listDecided`
- Extracted `<HeadlineTarget>` and `<ProsePanel>` into `src/components/changes/` — they were previously byte-identical between proposal-row and history-row
- `useChangeHistory` queryKey uses primitives + `staleTime: 30_000` instead of polling every 30s

## Seed updates

`modules/changes/seed.ts` now seeds five decided proposals (`PROP_APPROVED_SLACK`, `PROP_REJECTED_AGGRESSIVE`, `PROP_AUTO_DEREK`, `PROP_AUTO_AGENT_MEM`, `PROP_REJECTED_PRICEDROP`) so the History tab is non-empty on a fresh `bun run db:reset` and exercises every status variant.
