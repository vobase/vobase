---
'@vobase/template': minor
---

# profile.md becomes the canonical editable view for contacts and staff

YAML frontmatter at the top of `/contacts/<id>/profile.md` and `/staff/<id>/profile.md` is now the agent's structured-edit surface. The workspace-sync observer parses dirty profile.md, computes a diff against the canonical row, and submits a `field_set` change-proposal. Approval routes through the existing change-proposal pipeline:

- **Contacts** auto-apply by default; `displayName` and `email` queue for staff approval via the new `requiresApprovalForFields` registry option.
- **Staff** join the change-proposal pipeline for the first time (`requiresApproval: true`); all staff edits queue.
- **Markdown patches** to `profile` are no longer accepted on contacts — `MARKDOWN_FIELDS` is `{'memory'}` only. profile.md body below the frontmatter is auto-rendered.

**New surface:**

- `wake/profile-frontmatter.ts` exports `renderContactFrontmatter`, `renderStaffFrontmatter`, `parseFrontmatter`, and `diffProfile`. Render output is byte-stable (sorted keys, double-quoted strings, omits null / empty fields). Parser uses Bun's YAML 1.2 default so date strings stay strings.
- `modules/team/service/changes.ts` (new) ships `staffChangeMaterializer` for the `(team, staff)` resource pair. Allowed scalars: `{displayName, title, availability, capacity, expertise, sectors, languages}` plus `attributes.*`. `email` lives in `auth.user` and is intentionally out-of-scope for v1 (rejected with a `validation` error if proposed).
- `runtime/tz.ts` exports `ORG_TIMEZONE = process.env.TZ ?? 'Asia/Singapore'` as the seam for org-wide `date`-attribute interpretation.

**Changed:**

- `modules/changes/service/proposals.ts`: `registerChangeMaterializer` gains `requiresApprovalForFields?: ReadonlySet<string>`. When a `field_set` proposal touches a gated top-level scalar key, the proposal is forced to `pending` regardless of the resource-level default. `attributes.*` keys are not gated.
- `modules/contacts/agent.ts` and `modules/team/agent.ts`: profile.md materializers emit frontmatter via the new renderer; the read-only hint for profile.md paths is removed; AGENTS.md contributors are reframed to describe the editable frontmatter surface.
- `modules/agents/agent.ts`: the `agents.memory-conventions` contributor gains a `## Structured fields vs prose memory` section covering the three capture-trigger categories (customer-volunteered facts, staff-volunteered facts in internal notes, high-confidence inferences) plus the explicit `frontmatter vs MEMORY.md` split rule.
- `wake/observers/workspace-sync.ts`: on `agent_end`, profile.md edits route through `insertProposal` with a `field_set` payload built from `diffProfile(baseline, current)`. Unknown keys are dropped before `insertProposal` and warned. Empty diffs (reordered keys, no value change) produce zero proposals.
- `wake/workspace/index.ts`: profile.md paths move from `readOnlyExact` to `memoryPaths` so they're writable and tracked by the dirty diff.

**Manual smoke (not CI-gated).** Reproduce the GK Corp scenario against the dev server:

```bash
# 1. Send a customer message that volunteers structured facts.
curl -X POST http://localhost:3001/api/channels/web/inbound \
  -H 'Content-Type: application/json' \
  -d '{"contactId":"<id>","body":"I work at Northwind Logistics, 120 employees, renewal in September","externalKey":"web:demo"}'

# 2. Wait for agent_end; inspect the change_proposals row.
psql $DATABASE_URL -c "select id, status, payload from changes.change_proposals where resource_id='<id>' order by created_at desc limit 1;"

# 3. Confirm contacts.attributes was updated post-apply.
psql $DATABASE_URL -c "select attributes from contacts.contacts where id='<id>';"
```

Expected: one `change_proposals` row with `kind: 'field_set'` containing the three new attribute keys, status `auto_written` (no gated keys touched), and `contacts.attributes` reflecting the merged values.

## Lifecycle observability + agent acknowledgement

Built on top of the field_set work above so staff and the customer both get continuous feedback as a profile-edit moves through propose → decide → apply.

**New surface:**

- `wake/observers/sensitive-write-warner.ts` — `OnToolResultListener` that diffs `/contacts/<id>/profile.md` and `/staff/<id>/profile.md` after every `bash` tool call, lazily baselined per wake. When a gated frontmatter field (`displayName`, `email`) is touched it appends a `vobase notice:` block to the bash result's `stderr` — the *same* tool result the model is about to read — so the next assistant message can phrase the customer reply as a request that's been queued for staff review rather than confirming a change that's still pending. Cheap short-circuit on `args.command` keeps the disk reads off the hot path when the bash call doesn't reference a profile path. Gated key sets live in `wake/observers/gated-fields.ts` so workspace-sync and the warner share one source of truth.
- `wake/change-decided.ts` — `CHANGES_DECIDED_TO_WAKE_JOB` (`changes:decided-to-wake`) bridge: the decide endpoint enqueues a wake on conversation-bound proposals only (filters synthetic `operator-`/`heartbeat-` ids), `pg-boss` singletonKey on `(conversation, proposal, decision)` dedups rapid clicks. The handler boots a conversation-lane wake with the new `change_decided` trigger.
- `wake/events.ts` adds the `change_decided` `WakeTrigger` variant with `{proposalId, decision, resourceModule, resourceType, resourceId, summary, decidedNote, decidedBy}`. `wake/trigger.ts` registers the renderer (`renderChangeDecided`): on approval it requires a fresh customer reply even if the agent previously said "logged for review"; on rejection it surfaces the staff note to the agent (verbatim, marked "for your understanding only — do NOT quote") and asks for a polite acknowledgement. Both branches forbid re-attempting the write.
- `modules/changes/service/lifecycle-summary.ts` — backend-safe `summarizeLifecycleEvent` produces a short, contextual one-liner suitable for inline timeline rendering ("Email change to marc@x.com", "Display name and email change", "3 contact fields updated", "Memory note appended"). 12 unit tests pin behaviour.
- `tests/helpers/changes-smoke.ts` — atomic helpers (`open`, `sendInbound`, `waitForReply`, `insertPending`, `decide`, `listJournal`, `listActivity`, `listTranscript`, `close`) for stepping through the propose/decide/wake pipeline interactively against a live dev server. Reuses `devLogin` + `makeAuthedFetch` from `tests/smoke/_helpers.ts`.

**Changed:**

- `modules/changes/service/proposals.ts`: emits 4 lifecycle events into `harness.conversation_events` for any conversation-bound proposal — `change.proposed`, `change.auto_applied`, `change.approved`, `change.rejected`. The journal write is best-effort (try/catch + warn so a missing journal service in unit tests doesn't roll back the proposal tx). Emit sites consolidated via a `LifecycleVariant` discriminated union; the helper derives `proposalId`, `kind`, `resource*`, and `summary` from the proposal row so call sites only specify what varies. The decide endpoint additionally enqueues `CHANGES_DECIDED_TO_WAKE_JOB` for conversation-bound proposals.
- `modules/changes/module.ts`: installs a `decidedScheduler` that bridges service-level decide calls to the new pg-boss job.
- `modules/messaging/service/conversations.ts`: `TIMELINE_ACTIVITY_TYPES` extended with the 4 new `change.*` types so they flow through the existing `/api/messaging/conversations/:id/activity` endpoint.
- `modules/messaging/components/message-thread.tsx`: new `<ChangeActivityLine>` renders the journal `summary` as the primary line (rationale + decidedNote move to a `HoverCard` so the timeline stays scannable). The whole row links to `/changes?id=<proposalId>` so staff can jump to the proposal record. Suppresses system-emitted rejection tokens (`staff_rejected`, `threat_scan`).
- `modules/changes/pages/index.tsx` + `src/components/changes/change-history-list.tsx` + `src/components/changes/proposal-row.tsx`: route search schema accepts `id`; the page auto-switches to History when the linked proposal isn't pending, scrolls the matching row into view, and adds a 2.4s ring highlight (latched via `useRef` per `(highlightId, tab)` so realtime refetches don't re-fire). `ProposalRow`'s root went from `<li>` to `<div>` and the call sites wrap with `<li data-proposal-id>` so the structure stays valid.
- `wake/observers/workspace-sync.ts`: `WorkspaceSyncOpts` gains `conversationId` and the proposal write threads it through to `insertProposal` (was hardcoded `null`, which silently dropped lifecycle events for agent-driven edits).
- `wake/build-base.ts` + `wake/conversation.ts` + `wake/standalone.ts`: `composeHooks` accepts an optional `coreToolResults: OnToolResultListener[]` array; both lane builders thread the new sensitive-write-warner through it.
- `wake/prompt.ts`: static instructions gain a `## Bash sandbox` section listing the WebContainer toolchain (no `python`/`node`/`jq`/`yq`/`perl`/`ruby`) plus `sed`/`echo`/here-doc patterns for frontmatter edits with explicit insert-or-replace examples (a new contact's frontmatter often only has `displayName`+`marketingOptOut`, so a "replace existing key" sed silently no-ops on absent fields). Plus a `## When the customer asks you to write something` order-of-operations rule (attempt the write → cat to verify → read stderr notice → reply based on what the notice actually said).
- `modules/contacts/agent.ts`: AGENTS.md fragment for `contacts.contact-context` gains a 5-step workflow ("when the customer asks for a profile change") that explicitly forbids "logged for review" replies without a verified upstream edit.
- `runtime/bootstrap.ts`: registers the new `CHANGES_DECIDED_TO_WAKE_JOB` handler.

**Manual smoke (lifecycle):**

```bash
# Same dev-server prereqs as above.
bun -e '
  import { open, sendInbound, waitForReply, insertPending, decide, listActivity, close } from "./packages/template/tests/helpers/changes-smoke"
  const ctx = await open({ from: `smoke-${Date.now()}` })
  const conv = await sendInbound(ctx, "Quick question about your team.")
  await waitForReply(ctx, conv.conversationId, 0)
  const pid = await insertPending(ctx, { contactId: conv.contactId, conversationId: conv.conversationId, field: "email", value: `marc.${Date.now()}@example.com`, rationale: "Customer asked to update email on file" })
  await decide(ctx, pid, "approved")
  await waitForReply(ctx, conv.conversationId, 1)
  console.log(await listActivity(ctx, conv.conversationId))
  await close(ctx)
'
```

Expected: `change.approved` activity row carrying `summary: "Email change to …"` + `proposalId`; agent posts a brief customer-facing confirmation reply on the next wake.
