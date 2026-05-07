# @vobase/template

## 3.6.1

### Patch Changes

- [#75](https://github.com/vobase/vobase/pull/75) [`61b46b9`](https://github.com/vobase/vobase/commit/61b46b9b3daa18b0c4ef509881db8a4947eef0fc) Thanks [@amirahillyana](https://github.com/amirahillyana)! - fix(template): resolve dist/web from project root in production server

  `runtime/bootstrap.ts` computed the SPA dist directory as `join(import.meta.dir, 'dist', 'web')`, which resolves to `/app/runtime/dist/web` at runtime. The Vite build outputs to `/app/dist/web`, so the `index.html` lookup always failed and the static-files block silently no-op'd — every freshly-deployed tenant returned Railway's edge 404 on `/`. Walk one directory up so the path matches the Dockerfile layout.

## 3.6.0

### Minor Changes

- [`354da30`](https://github.com/vobase/vobase/commit/354da30c3dfd9edb84d9ab3a8e04efb213c24d0e) Thanks [@mdluo](https://github.com/mdluo)! - # profile.md becomes the canonical editable view for contacts and staff

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

  - `wake/observers/sensitive-write-warner.ts` — `OnToolResultListener` that diffs `/contacts/<id>/profile.md` and `/staff/<id>/profile.md` after every `bash` tool call, lazily baselined per wake. When a gated frontmatter field (`displayName`, `email`) is touched it appends a `vobase notice:` block to the bash result's `stderr` — the _same_ tool result the model is about to read — so the next assistant message can phrase the customer reply as a request that's been queued for staff review rather than confirming a change that's still pending. Cheap short-circuit on `args.command` keeps the disk reads off the hot path when the bash call doesn't reference a profile path. Gated key sets live in `wake/observers/gated-fields.ts` so workspace-sync and the warner share one source of truth.
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

  ## propose_contact_update — first-class tool for customer-asked profile edits

  Closes the agent-tool-discipline gap that surfaced during the lifecycle smoke: with bash-edited `profile.md` as the only path, `gpt-5.4` (and Sonnet, tested via single-line model swap) reliably skipped the bash sed for customer-asked profile updates and replied with a hallucinated "logged for review" — silently breaking the propose pipeline (no `change_proposals` row, no journal event, no staff inbox entry, no `sensitive-write-warner` notice). 5 consecutive baseline runs produced 0 proposals; 4 prompt iterations did not move the model.

  **New surface:**

  - `modules/contacts/tools/propose-contact-update.ts` — conversation-lane, customer-facing tool. `audience: 'customer'`, `lane: 'conversation'`. Resolves `contactId` from `ctx.conversationId` (the model can't pick the wrong contact). Input is `{patch, rationale}` where `patch` accepts `{displayName, email, phone, segments, marketingOptOut, attributes}`; `attributes` is a flat map flattened to `attributes.*` field_set keys server-side. Builds the `field_set` diff against the current row, reuses `buildFieldSetCopy` for `expectedOutcome`, and forwards the model's `rationale` verbatim to `insertProposal`. Returns `{proposalId, status, fieldsTouched, replyHint}` where `replyHint` is one of three deterministic strings keyed off `status`:
    - `auto_written` → "Tell the customer the change is done (it applied immediately and is now on file)."
    - `pending` → "Tell the customer it's logged for our team to review (a gated field was touched)."
    - `no_op` → "No values would change — the patch you proposed already matches what's on file."
      Idempotent on rapid double-call: a duplicate-pending conflict from `insertProposal` collapses to `{status: 'pending', proposalId: null}` rather than re-throwing, so the model still gets a deterministic answer.
  - 7 unit tests in `modules/contacts/tools/propose-contact-update.test.ts`. Uses `mock.module('@modules/changes/service/proposals', …)` because `wake/observers/workspace-sync.test.ts` and `wake/observers/learning-proposals.test.ts` already mock that module process-wide; an `installChangeProposalsService` stub would silently lose to their `mock.module` replacement.

  **Changed:**

  - `modules/contacts/agent.ts`: registers `proposeContactUpdateTool` in `contactsTools` and rewrites the `contacts.contact-context` AGENTS.md fragment to lead with the tool. The 5-step bash workflow is replaced with a 3-step tool workflow ("call `propose_contact_update`; read the returned `status`; reply accordingly"). Bash-editing `profile.md` is demoted to operator/admin workflows; the fragment explicitly tells the agent that bash-as-customer-shortcut is silently ignored.

  **Verified.** Re-running the same gpt-5.4 baseline smoke after the fix:

  | Runs       | bash calls | proposals created | journal events        | reply matches reality          |
  | ---------- | ---------: | ----------------: | --------------------- | ------------------------------ |
  | Before fix |      0 / 5 |             0 / 5 | none                  | "logged for review" — false    |
  | After fix  |      0 / 4 |         **4 / 4** | `change.proposed` × 4 | "logged for review" — **true** |

  Plus a non-gated phone-update run that auto-wrote (`status=auto_written`, `contacts.phone` updated to the new value) and the agent replied with the corresponding "all set" copy.

### Patch Changes

- [`7776abf`](https://github.com/vobase/vobase/commit/7776abf49c838c6e1d86227917782a6a516075d4) Thanks [@mdluo](https://github.com/mdluo)! - # Tint composer background when in internal-note mode

  The inbox composer uses a single `PromptInput` for both customer reply and internal-note modes, distinguished only by the active tab. Switching to **Note** changed the placeholder and submit label but left the input box visually identical to a customer reply, so it was easy to mistake one for the other at a glance.

  Match the composer surface to the note message bubble (`bg-amber-50/70` light, `bg-amber-950/25` dark, `border-amber-500/30`) when `mode === 'note'`. Reply mode is unchanged. Same color tokens already used by `NoteRow` in `message-thread.tsx`, so the composer reads as a draft of the bubble it will produce.

- [`9bc15cd`](https://github.com/vobase/vobase/commit/9bc15cd3443d8bf126601e5e58b86232cbabbfa9) Thanks [@mdluo](https://github.com/mdluo)! - # Full-height Drive on detail pages, agent page joins side-by-side layout

  Three follow-ups to the contact/team detail-page rework:

  - **Agent detail page now uses the same two-column layout.** Settings + Save on the left, vertical-orientation Drive on the right. Save button is contextual — only renders while the form is dirty.
  - **Drive panel fills the column on `lg+`.** Detail pages flip `PageBody` to `flex flex-col` and the grid container to `flex-1` so the right column claims all remaining vertical space; `DriveSection` takes `lg:h-full` to override the default `h-[60vh]`. Below `lg` Drive keeps the original 60vh box. Left column gets its own internal scroll if its sections exceed the available height.
  - **Vertical Drive prefers content over file list.** When `orientation="vertical"` and a file is selected, the grid splits the panel `1fr` for the file list and `2fr` for the preview/editor (was `1fr/1fr`), so AGENTS.md / PROFILE.md / etc. get the room they need without shrinking the file list to nothing.

- [`9555875`](https://github.com/vobase/vobase/commit/95558755e1dbc30460fd2530b989333f43670f69) Thanks [@mdluo](https://github.com/mdluo)! - # Side-by-side detail pages with vertical Drive

  The contact and team detail pages now use a two-column layout on `lg` and up: identity sections on the left, the entity's Drive on the right. The previous stacked layout pushed Drive below the fold whenever the attributes list grew.

  **Two sections per entity, one role each.** Native fields (Email/Phone/Segments/Marketing on contacts; Title/Availability/Capacity/Sectors/Expertise/Languages on staff) sit in a read-only `InfoCard` with an Edit button that opens the existing form dialog. Custom attributes sit in their own `InfoCard` with inline-editable rows, dirty-tracking, and a contextual `Save (N)` button that only appears while a field is dirty.

  **Add new attributes from the detail page.** A `+ Add attribute` row at the end of the attributes card opens the existing `AttributeFormDialog` to create a new definition, which appears on every contact/staff member via query invalidation — no detour to `/contacts/attributes` or `/team/attributes` for one-off fields.

  **Drive can stack vertically.** `DriveBrowser` takes a new `orientation: 'horizontal' | 'vertical'` prop; `vertical` switches the desktop grid from columns to rows so the file list sits on top and the preview stacks below. Detail pages pass `vertical` so Drive fits in a single right-column box; the standalone `/drive` page keeps the original horizontal split.

  Other cleanup: removed the staff `Profile` field from the dialog (already covered by `/PROFILE.md` inside Drive), dropped the unused module-level `attribute-table` wrappers and the shared `src/components/attributes/attribute-table.tsx`, and removed the "Settings" section heading on the agent detail page so its `InfoCard` matches the other detail pages' style.

- [`466ff11`](https://github.com/vobase/vobase/commit/466ff1187e960443a753c717e46d543284a9ca92) Thanks [@mdluo](https://github.com/mdluo)! - # Memory hygiene: budget headers, capture triggers, scope conventions

  Revamp how the agent harness instructs and budgets `MEMORY.md` across all three scopes (agent self / contact / staff).

  **AGENTS.md additions** — three new sections compose into every wake's AGENTS.md:

  - `agents.self-state` (priority 20, trimmed) — file locations only, no longer carries capture imperatives.
  - `agents.memory-capture-triggers` (priority 25) — "## When to capture" with the auto-loop reframe (do NOT echo `internal_note_added` / supervisor coaching; the self-learn loop captures those automatically). Lists keywords (`always`, `never`, `from now on`, `remember that`, `next time`) for mid-wake self-lessons only.
  - `agents.memory-conventions` (priority 26) — three-row scope table (agent / contact / staff) with paths, when-to-write, append + sed mutation patterns, and a 30-day prune rule.

  **Per-wake budget header** — every materialized `MEMORY.md` gains a deterministic `<!-- memory-budget scope=... id=... chars=N (utf16) cap=8000 over=true|false -->` line as a soft visibility hint. Header is render-time only and `stripBudgetHeader` keeps storage clean (no header round-trip into the DB column on workspace-sync flush). Header surface is capped to the first 5 staff ids per wake (`STAFF_BUDGET_HEADER_CAP`); body materialization still iterates all `staffIds` so the workspace surface is unchanged.

  **Self-learn loop fix** — `Note: —` empty-body bug in the `## Staff signal —` block that the `learning-proposals` observer appends. The supervisor wake's `agent_start` payload only carries `noteId`; the observer now looks up the body via `listNotes(conversationId)`, capped at 800 chars, so the captured rule actually surfaces in working memory.

  **Determinism** — `wake/memory-budget.ts` is byte-pure (source-regex guard bans `Date`, `Math.random`, `process.env`, `os.hostname`, `__dirname`, etc.). Cross-wake `systemHash` stability test added to `wake/prompt.test.ts` covering all three scope headers reaching the rendered system prompt.

  **Tests** — 79 passing across `wake/memory-budget.test.ts`, `wake/observers/workspace-sync.test.ts`, `wake/observers/learning-proposals.test.ts`, `modules/{agents,contacts,team}/agent.test.ts`, `wake/prompt.test.ts`, `wake/build-base.test.ts`. Live smoke verified the GK Corp regression bug (customer-volunteered facts now persist to `/contacts/<id>/MEMORY.md`).

## 3.5.0

### Minor Changes

- [`927b0ea`](https://github.com/vobase/vobase/commit/927b0eaf87d705554f78b1956e77e204f10972fe) Thanks [@mdluo](https://github.com/mdluo)! - # Fix: managed-mode WhatsApp end-to-end wire delivery

  Customer messages reaching the agent via the platform-managed WhatsApp sandbox produced agent replies that landed in the inbox UI but never reached the customer's WhatsApp. Diagnosis surfaced two independent bugs at the egress boundary plus three smaller papercuts around sandbox claim ergonomics.

  ## What changed

  ### Identity vs. external keys (`@modules/contacts`)

  Inbound contact resolution stamped a canonical `${channel}:` prefix onto `contacts.phone` (so `whatsapp:6512345678` instead of `+6512345678`) to keep external keys non-colliding across channels. Outbound dispatch then handed that prefixed value verbatim to `adapter.send({ to })`, and Meta's Graph API silently rejected the malformed recipient — agent reply persisted, wire never fired.

  The fix splits identity from per-channel dedup keys.

  - **New table** `contacts.contact_external_keys (org_id, channel, external_key, contact_id)` with PK on the triple, index on `contact_id`. Inbound dispatch resolves the contact via this table.
  - **`contacts.phone` and `contacts.email` are now bare canonical identity** (E.164 with leading `+`, lowercased RFC email) — no channel prefix. Outbound reads them directly with no stripping.
  - **New normalizers** `normalizePhoneE164` (strip non-digits, prepend `+`, length-bound 7–15) and `normalizeEmail` (trim + lowercase) in `modules/contacts/service/identity-normalize.ts`. Light-touch, no `libphonenumber-js` dep — forks that need region-aware validation can compose their own.
  - **`upsertByExternal` → `upsertByExternalKey`** with shape `{ organizationId, channel, externalKey, phone?, email?, displayName? }`. Lookup chain: existing key row (single `INNER JOIN`) → existing contact by `phone` or `email` for cross-channel merge → fresh contact + key row. Idempotent key insert with re-fetch handles concurrent inbound races.
  - **Inbound dispatch** reads `adapter.contactIdentifierField` to decide whether `event.from` is a phone (normalize → store as `phone` AND key), email, or opaque session token (key only, no phone/email). Adapter resolution now throws on unknown channel instead of silently treating raw `event.from` as the dedup key.

  `packages/template/modules/contacts/seed.ts` is unchanged — the seed contacts already used bare `+E.164` phones; the prefix scheme was an inbound-only convention.

  ### Tenant signing for managed-mode outbound (deferred to platform fix)

  The tenant-side outbound signing was correct end-to-end. The platform's `verifyTenantSignature` middleware was using tenant-level HMAC for verification while the platform's own forwarded webhooks used per-channel claim secrets — causing every outbound graph proxy call to 401 with `Invalid signature (v2)`. That asymmetry is fixed in `vobase-platform` (separate commit); no further tenant change required.

  ### Sandbox-claim ergonomics

  - `claim-sandbox-dialog.tsx` no longer gates the "Claim sandbox" button on `availability > 0`. The platform's `allocateManagedChannel` is idempotent on `(tenantSlug, environment, channelInstanceId)` and self-heals orphan claims; gating the click would make those self-heal paths unreachable for any tenant whose `/health` reports zero free slots due to a stale claim row.
  - `handshake.ts::fetchSandboxAvailability` now throws `PlatformHandshakeError('platform_unauthenticated')` when the platform's `/health` strips data fields due to HMAC verification failure, instead of returning `{ sandboxPoolAvailable: 0 }` and masquerading as pool exhaustion. The dialog now shows the actual auth-failure reason.
  - `channel-row-menu.tsx` web variant now wraps the dropdown trigger in a `flex items-center justify-end` container to match the WhatsApp variant — fixes misaligned menu buttons in the channels table.

  ### Tests

  - New `identity-normalize.test.ts` covers length bounds + null/empty rejection.
  - `echoes.test.ts` and `webhook-routing.test.ts` register a stub WhatsApp adapter via the registry now that inbound dispatch hard-errors on missing adapter.
  - `wake/workspace/create.test.ts` and `web/tests/inbound.test.ts` updated for the renamed method.

  ## Migration

  Schema changes mean `bun run db:reset` is required after pulling this. There's no in-place migration — projects forked from the template before this should: pull the new `contacts/schema.ts` + `contacts/service/`, run `db:reset`, and re-pull `channels/service/inbound.ts` + `channels/adapters/web/handlers/inbound.ts` to use the new service shape.

  ## Deferred

  - E.164 region-aware normalization (Brazil 12↔13-digit, etc.) — channel adapters with region quirks should compose their own normalizer over `normalizePhoneE164`.
  - Cross-channel merge race window — relies on the existing `(orgId, phone)` unique index surfacing as a hard error if two concurrent inbounds race to create the same contact. Closing the window cleanly would need a wrapping transaction with `SELECT ... FOR UPDATE`; out of scope for a scaffold.
  - Contact form normalizer divergence — `contact-form-dialog.tsx` still trims raw input; aligning with `normalizePhoneE164` would close a future-state where a form-entered phone could mismatch an inbound-resolved phone for the same person.

### Patch Changes

- [#71](https://github.com/vobase/vobase/pull/71) [`27490cf`](https://github.com/vobase/vobase/commit/27490cfa091248033ef194e57efb3aa4a4734eca) Thanks [@TheSoggy](https://github.com/TheSoggy)! - # Drop epoch-stamped skip cache from test-db helper

  `tests/helpers/test-db.ts` cached `bun run db:reset` results via a 5-second `RUN_EPOCH` sentinel — files whose `beforeAll` landed within the same epoch as a successful reset would skip resetting. Sound for deduplicating parallel-worker setup, but unsound for tests that mutate seed rows: any DELETE/UPDATE in one file polluted the seeded DB for every later file inside the same epoch window. Manifested as order-dependent FK violations (`messaging.conversations.contact_id → contacts.contacts(id)`) and an anonymous `(unnamed)` mid-suite `db:push failed` whose 5-second duration matched the epoch bucket.

  Drop the cache. Every test file's `beforeAll` now reseeds unconditionally under the existing flock. No DB-lifecycle issues — `bun run db:reset` works fine even when other test processes hold open `postgres` connections (verified empirically with sequential subprocess invocations).

  **Suite impact**: 0 failures (was 4); 67-71s runtime (was ~8s, but with 4 polluted-state failures). Stable across 3 consecutive runs. If suite latency becomes a concern, the next iteration is in-process `TRUNCATE ... CASCADE` + reseed using the existing module `seed(db)` exports — same correctness, sub-second per file.

  Resolves [#69](https://github.com/vobase/vobase/issues/69).

- [`8cdbb57`](https://github.com/vobase/vobase/commit/8cdbb57daf4dac65391cae6dfea7656f681175c6) Thanks [@mdluo](https://github.com/mdluo)! - # WhatsApp card rendering, agent handoff UX, and supervisor coaching fixes

  Six related fixes uncovered while debugging local-chat conversations on the
  managed-WhatsApp sandbox.

  **WhatsApp `send_card` now renders all child elements.** Outbound dispatch
  previously squashed cards to `title + subtitle`, dropping every `fields`,
  `text`, `link`, `image`, `divider`, and `link-button` child. The new
  `cardToOutbound` helper walks card children in order and emits a real
  `metadata.interactive` payload — `type=button` for ≤3 reply buttons,
  `type=list` for 4–10. Non-WhatsApp channels fall back to plain text. Footer
  is intentionally not auto-promoted from a trailing text child (the schema has
  no footer signal and any heuristic misclassifies normal prose).

  **Web inbox card buttons are read-only for staff.** The web `MessageCard`
  now threads a `readOnly` prop down to `CardActions`; the staff inbox passes
  it (`message-thread.tsx`), so buttons render disabled and never POST a
  card-reply. The first reply button's `primary` style maps to `default` on
  web — leading-button emphasis is a WA/Teams renderer convention that read as
  a bug in the inbox.

  **Agent → human reassignment requires a customer-facing acknowledgment.**
  Adds `messages.hasRecentAgentReply(conversationId, withinSeconds)` and gates
  `conv reassign --to=user:<id>` on it: the verb refuses with
  `errorCode: 'no_customer_ack'` if the agent hasn't sent a `reply` /
  `send_card` / `send_file` in the last 60 seconds. Verb description and
  `prompt` rewritten as a 3-step handoff playbook so the agent is told
  explicitly to acknowledge BEFORE flipping the assignee.

  **Managed-WhatsApp adapter no longer races vault load.** The previous
  `void loadRotation(...).catch(swallow)` warm-load could resolve after the
  first outbound, throwing "vault not yet loaded" on the wire. The factory
  now awaits the initial rotation load; `loadRotation` deduplicates concurrent
  calls so subsequent adapter constructions for the same org pay an in-memory
  hit. `ChannelAdapterFactory` now accepts `Promise<ChannelAdapter>`;
  `registry.get()` is async; every caller (`outbound`, `inbound`,
  `mention-notify`) awaits.

  **Supervisor coaching wakes get a clearer playbook.** `wake/trigger.ts`
  leads with `cat <conv>/internal-notes.md` so the model can't treat reading
  the staff note as optional, then directs the agent to capture a durable
  lesson in MEMORY.md. `wake/prompt.ts` reorders the system prompt so
  `MEMORY.md` (renamed to "## Active lessons — apply these rules on every
  reply") sits before AGENTS.md — durable rules ahead of static guidance.
  `learning-proposals.ts` skips signals whose `notePreview` is present-but-blank
  to avoid `Note: —` stubs.

  **`agents.agent_threads*` renamed to `operator_threads*`** to disambiguate
  from `harness.threads` (the conversation lane). Schema, seeds, services,
  handlers, the standalone wake builder, and the operator-chat component all
  updated atomically. No data migration — template scaffolding only.

  Includes test coverage: `outbound-card.test.ts` (13 cases for WA interactive
  shapes, fixture, fields/link-button, truncation, no-footer assertions);
  `conv-reassign.test.ts` (4 cases covering happy path, block, staff bypass,
  agent-target bypass); `messages.test.ts` extensions for `hasRecentAgentReply`;
  `learning-proposals.test.ts` for the empty-note skip; thread test updates
  for the rename.

## 3.4.0

### Minor Changes

- [`e3d4817`](https://github.com/vobase/vobase/commit/e3d48170834b8be36413c7dcd8bee3cc14f0411e) Thanks [@mdluo](https://github.com/mdluo)! - # Changes module: history audit log + self-learn observer

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

### Patch Changes

- [`7c8fe1d`](https://github.com/vobase/vobase/commit/7c8fe1d06cdf30930e2c9af6b14f3198517c8474) Thanks [@mdluo](https://github.com/mdluo)! - # Fix: outbound dispatch + media + tenant scope

  Agent replies (`reply`, `send_card`, `send_file`) and staff replies were persisted to the inbox but never reached the wire — both owned and managed (platform-proxy) WhatsApp. The web channel masked the bug because its `send()` is a no-op (the realtime push from the row insert delivers to browsers, but no Graph API call is ever made for WhatsApp).

  ## What changed

  ### `sendOutbound` seam wired end-to-end

  A new install-time service (`installOutboundService`, mirroring the `installMessagesService` pattern) is the single seam for outbound delivery. After persisting their message row, `reply.ts`, `send-card.ts`, `send-file.ts`, and `staff-reply.ts` now call `sendOutbound`, which resolves the channel adapter via the registry, enforces the 24h messaging window for windowed channels, and calls `adapter.send()`.

  Adapter resolution is **instance-keyed** — `registryGet(channel, config, instance.id)` — which is what makes managed-mode WhatsApp actually deliver. The managed adapter is constructed bound to the instance's vault rotation so the platform proxy receives correctly-signed requests.

  ### Cross-tenant assertion

  `SendOutboundInput` now requires `organizationId`. Inside `sendOutbound`, every conversation/contact/instance lookup asserts `row.organizationId === input.organizationId` before proceeding. Closes a cross-tenant exfiltration primitive: a wake on `org-A` could previously pass a `conversationId` from `org-B` (e.g. via prompt injection in customer content) and reach `org-B`'s wire signed with `org-B`'s vault keys.

  ### Channel-aware recipient

  The previous `contact.phone ?? contact.email ?? contact.id` fallback could send a nanoid as the wire address. `sendOutbound` now reads `adapter.contactIdentifierField` and throws cleanly if the contact lacks the required handle for that channel — no more silent message-loss for contacts missing a phone number.

  ### Real media support for `send_file`

  `send_file` now resolves the drive row via `filesServiceFor(orgId).get(driveFileId)`, downloads bytes via `getDriveStorage().bucket('drive').download(storageKey)`, maps the mime type to `image | video | audio | document`, and ships a real `OutboundMessage.media[]` payload. The WhatsApp adapter's existing bytes-upload path (`sendMedia` → Graph `/PHONE_ID/media` → upload id) handles the rest.

  A scope check rejects sending another contact's private file: the drive file must be `organization`-scoped, or `contact`-scoped to the conversation's contact, or `agent`-scoped to the current agent. Closes a within-tenant lateral-access path where prompt injection from contact-X could leak contact-Y's private upload from the same org.

  Virtual files (no `storageKey`, e.g. `MEMORY.md` overlays) throw cleanly.

  ### `SendResult` failures surface to the agent

  A new `throwIfFailed(result, toolName)` helper bubbles `success: false` outcomes out of every tool. `code === 'window_expired'` throws with a template-fallback hint (`Messaging window expired — fall back to a pre-approved template`); other failures bubble `code` + `error`. Replaces the silent `await sendOutbound(...)` that swallowed Graph 5xx and window-expired short-circuits.

  ### Declarative per-adapter platform hints

  Each channel adapter now owns its prompt hint alongside `agent.ts`:

  | Adapter                                       | Export                 |
  | --------------------------------------------- | ---------------------- |
  | `modules/channels/adapters/web/agent.ts`      | `webPlatformHint`      |
  | `modules/channels/adapters/whatsapp/agent.ts` | `whatsappPlatformHint` |

  The umbrella `modules/channels/agent.ts` aggregates `platformHints: HarnessPlatformHint[]`, and `wake/platform-hints.ts` is now a thin registry built from that list. Adding a new channel adapter only touches its own folder. Vestigial `email`/`sms`/`voice` entries removed since no adapters back them today — re-add them in their adapter folder when wired.

  ## Tests

  Test stubs for the four sender paths now use counted-spy fakes that assert `sendOutbound` was called with the right `(toolName, organizationId, conversationId)`. A regression test for `window_expired` confirms the failure-path bubbles a tool error mentioning the template fallback. A regression on the wire path can no longer pass.

  ## Migration

  No schema changes. No new dependencies. No new pg-boss jobs. The `installOutboundService` call lands in `modules/channels/module.ts::init` — projects scaffolded from this template before this fix should re-pull the channels module init or call `installOutboundService(createOutboundService())` themselves at boot.

  `ChannelOutboundEventSchema` was removed from `runtime/channel-events.ts` (no remaining consumers); inbound schema and `OUTBOUND_TOOL_NAMES` retained.

  ## Deferred

  The following were intentionally scoped out and remain follow-ups:

  - `send_card` → real WhatsApp interactive payload (buttons / list pickers); currently flattens to plain text.
  - `messages.status` state machine (`queued → sent → failed`) + delivery retry queue.
  - E.164 normalization on WhatsApp `to:` at the egress boundary.
  - Managed-mode env-fallback regression-guard (a config row that loses `mode: 'managed'` currently falls back to env-var creds).
  - `runThreatScan` is still a `return { ok: true }` stub on the `send_file` path.
  - `staff_reply` attachments persist on the row but only the text body flows to the wire.
  - `installOutboundService` cross-test bleed sweep (pre-existing pattern across all `install*` services).

- [#67](https://github.com/vobase/vobase/pull/67) [`fb8f6bd`](https://github.com/vobase/vobase/commit/fb8f6bd3d5a724b124a187b70307cacdf14531c6) Thanks [@TheSoggy](https://github.com/TheSoggy)! - # Fix theme FOUC bootstrap and echoes test setup

  Two unrelated, mechanical fixes from running the unmodified scaffold:

  **`index.html` theme bootstrap reads stale storage key.** The pre-paint FOUC-prevention script in `index.html` reads `localStorage.getItem("template-v2-theme")`, but `theme-provider.tsx` (and its test) write/read `vobase-theme`. This causes the bootstrap script to never find a saved preference and always default to `system`, producing a real flash on hydration for users who'd selected `light` or `dark`. Aligns the bootstrap with the actual storage key.

  **`modules/channels/adapters/whatsapp/echoes.test.ts` missing contacts service install.** The test's `beforeAll` installs `conversations`, `messages`, `sessions`, `reactions`, and `channels` services but never installs `contacts`. Because `dispatchInbound` → `contacts.upsertByExternal` reads the contacts singleton, every test in the file throws `contacts/contacts: service not installed`. Adds the install matching the canonical pattern in `tests/helpers/attachments-fixture.ts`.

  After these fixes: 1 previously failing test goes green (theme FOUC), and the `smb_message_echoes` tests pass cleanly when the file is run in isolation. (The echoes tests still fail in the full-suite run due to a separate cross-test DB-state pollution issue — filing a separate report.)

## 3.3.0

### Minor Changes

- [`2964598`](https://github.com/vobase/vobase/commit/2964598ecf41eec727df4329be1132228b9421ab) Thanks [@mdluo](https://github.com/mdluo)! - # Drive (Upload + OCR) and WhatsApp Channel

  Two end-to-end template features ship together, both already exercised by the canonical helpdesk scaffold.

  ## Drive: upload, OCR, and inbound auto-ingest

  The `drive` module is now a real agent filesystem. Staff and inbound channels both write through one `ingestUpload(input)` seam; readable artifacts are normalized to `.md` so the agent's bash sandbox can grep them.

  - **Storage seam.** `ModuleInitCtx` now carries `storage: StorageAdapter` (local in dev, S3/R2 in prod). Modules consume a single adapter; no per-module file plumbing.
  - **Upload pipeline.** `drive:process-file` job extracts text per mime, with a per-page readability gate for PDFs (`MIN_READABLE_CHARS_PER_PAGE = 40`, `MIN_PRINTABLE_RATIO = 0.6`) — pages that fail the gate are routed through OCR rather than trusting watermark glyphs.
  - **OCR provider.** `lib/ocr-provider.ts` uses `@ai-sdk/openai` directly via `provider.chat(...)`. Bifrost mode → `google/gemini-2.0-flash`; direct mode → `models.gpt_mini`. Provider + `generateText` memoized so an N-page PDF reuses one handle.
  - **Hybrid search.** New `drive_chunks` table backs pgvector + tsvector hybrid search. Post-rank phase batches chunk → file lookups (2 SELECTs total for a 10-hit search; pinned by `files-search.test.ts`).
  - **Caption + binary stub.** Every file carries a deterministic 120-char `caption` projection (no LLM on the hot path). Binary files get a stub row plus the agent's new `request_caption` tool, which fires a `caption_ready` wake when extraction completes.
  - **Cost ceilings.** Per-org daily budget gate at `modules/drive/service/budget.ts` reads `harness.tenant_cost_daily`. Jobs past the ceiling fail with `processingError = 'org_daily_budget_exceeded'` rather than uncapped spend.
  - **Inbound auto-ingest.** WhatsApp inbound media (`MessageReceivedEvent.media[]`) auto-ingests under `/contacts/<id>/<channelInstanceId>/attachments/`. `messages.attachments` jsonb carries refs; `messages.md` materializer renders inline caption blocks per attachment.
  - **Loser-of-race reap.** Concurrent webhook redeliveries (Meta retries 5xx up to 7 times) call `filesService.reapAttachmentRows(...)` from `createInboundMessage` on `channelExternalId` unique-violation, so duplicate drive rows never persist.
  - **Drive UI.** `<DriveFileList>` gains drag-and-drop upload (folder-scoped overlay, multi-file with toast), per-row 3-dot menu (Rename inline, Delete via AlertDialog, Download original when display ext ≠ original ext), pending-uploads counter, status pill with `processingError` tooltip.
  - **Failure paths.** Post-storage UPDATE failure deletes the just-uploaded storage object and marks the row `(failed, failed)` with a structured `processingError`. `markFailed` and embedding-fail catch in `jobs.ts` log via `@vobase/core` logger so operators can grep stderr.
  - **Wake bus rename.** `INBOUND_TO_WAKE_JOB → AGENTS_WAKE_JOB`; pg-boss queue renamed to `'agents:wake'`. `WakeTriggerSchema` is `z.discriminatedUnion('trigger', [...])` with paired-shape compile-time drift guard.

  ## WhatsApp channel

  End-to-end Cloud API support across self-managed and platform-managed modes — see [`@vobase/core@0.36.0`](https://github.com/vobase/vobase/releases) for the underlying transport seam, envelope-encrypted vault, and 2-key HMAC sig v2 contract.

  Template-side surfaces:

  - **Embedded Signup.** `<WhatsAppSignupButton variant="hero" | "compact">` Facebook SDK launcher, server-side code exchange (`/signup/start` + `/signup/exchange`), nonce table bound to `(orgId, sessionId)` with 5-min expiry, mandatory `debug_token` validation, per-org rate limit (10/h), per-IP failure bucket (60/min).
  - **Coexistence.** `smb_message_echoes` parsed and persisted as `role='staff', metadata.echoSource`. Echoes do NOT enqueue wake jobs, do NOT open the 24-hour service window, do NOT fan out `add_note`.
  - **Platform-managed sandbox.** Tenant config carries only `{ mode: 'managed', platformChannelId, platformBaseUrl }` — zero Meta credentials at rest. TOCTOU-safe `upsertManagedInstance` via Postgres generated column + partial unique index.
  - **24-hour service window.** `messaging.conversation_sessions` tracks open sessions per `(conversationId, channelInstanceId)`. Outbound dispatcher precheck returns `SendResult { code: 'window_expired' }` instead of attempting a doomed send.
  - **Status FSM + reactions.** `messages.updateDeliveryStatus()` enforces `queued → sent → delivered → read` (no backward); `failed` terminal; never mutates `role`/`content`. Reactions write through new `messaging/service/reactions.ts` only — `check:shape` enforced.
  - **Doctor.** `vobase channels:doctor :instanceId` runs `debug_token`, `subscribed_apps`, `phone_numbers`, `message_templates`, surfaces results in `<InstanceDoctorSheet>` with red/amber/green pills.
  - **Channels admin UI.** Single unified `<ChannelsTable>` (DiceUI data-table) replaces the prior tile catalog. WhatsApp + Web channels coexist with a `<ModeChip>` per row. Row-action menu opens slide-over sheets for Doctor (WA), Templates (WA), Embed snippets (Web).
  - **CLI verbs.** `vobase channels:list`, `vobase channels:instance:show :id`, `vobase channels:doctor :id`, `vobase channels:templates:sync :id`.
  - **TRUST_PROXY_HOPS.** New env var defaults to `0` (ignore XFF) for prod safety. Operators behind a sanitizing proxy must set it explicitly.
  - **Admin role gating.** `getRequireAdmin()` lazy accessor enforces `owner | admin` on every signup/managed/doctor mutation route.

  ## Frontend bundle isolation

  `check:bundle` extended to forbid `~/runtime` imports from `src/**` so backend code (auth handles, db client, jobs) cannot leak into the browser bundle.

  ## Test coverage

  - 23 new test files spanning e2e (caption-ready wake, attachment auto-ingest, attachment failure/orphan, inbound redelivery, loser-of-race reap, full ESU flow), integration (managed transport, echoes, doctor, signup nonces), unit (sessions FSM, reactions, dispatch routing, request-IP `TRUST_PROXY_HOPS`), and live smokes (`bun run smoke:wa` covering inbound, outbound echo, doctor, templates).
  - 616 passing / 5 skipped / 1 todo at the end of the slice; 6 pre-existing failures (contacts service not installed in test env) unchanged.

  ## Operational notes

  - **Backfill:** ops needs to populate `tenant_environments` rows for existing managed tenants so the per-env webhook resolver targets the right `instanceUrl`. Falls back gracefully today.
  - **Open follow-ups (non-blocking):** `Reassign default…` row action wired but disabled (needs AssigneeSelect popover); `mergeContacts(...)` is a JSDoc-only skeleton; vault `previous` decryption is eager per read (bounded by 60s rotation cache TTL — optional lazy follow-up); WA-inbound live smoke deferred until `META_WA_*` configured in dev.

## 3.2.1

### Patch Changes

- Updated dependencies [[`02a1b87`](https://github.com/vobase/vobase/commit/02a1b87bfcab7645590802b04fbc7e0c57378568)]:
  - @vobase/core@0.36.0

## 3.2.0

### Minor Changes

- [`5c5c277`](https://github.com/vobase/vobase/commit/5c5c27784c91c96441918e0a5c42ace2b5833c77) Thanks [@mdluo](https://github.com/mdluo)! - End-to-end UI revamp of the template app: mobile-first shell, canonical layout
  and card primitives, and a Craft-style information-forward look.

  **Layout primitives.** New `PageLayout` / `PageHeader` / `PageBody` (in
  `src/components/layout/page-layout.tsx`) — every top-level page now slots into
  the same shell instead of hand-rolling section/header markup. Thirteen pages
  migrated. PageBody defaults to a subtle gray (`bg-muted/40`) with edge-to-edge
  horizontal padding; pages that want a centered column wrap their children in
  `mx-auto w-full max-w-4xl` so the gray field extends behind the cards.

  **Mobile-first AppShell + stack-and-push ListDetailLayout.** The shell renders a
  desktop rail or a mobile bottom-nav based on viewport. List/detail surfaces
  (inbox, team, contacts) push the detail pane onto a stack on mobile and reveal
  an inline chevron back affordance in `PageHeader`. Rail and conversation list
  are resizable + collapsible with persisted layout. Rail compacts at 80px
  (snap-collapsed icon-only width) instead of 160px, and active state is read
  from TanStack Router's `data-status="active"` attribute so the mobile
  bottom-nav highlight finally renders correctly. PRIMARY_NAV order: Inbox,
  Contacts, Agents, Changes, Drive.

  **Canonical card surface.** New `InfoCard` / `InfoRow` / `InfoSection` in
  `src/components/info` — `rounded-lg bg-background shadow-sm` with sibling
  dividers, no border. shadcn `Card` aligned to the same surface (override
  marker added). `SettingsCard` is now a thin alias. Pending-changes proposal
  cards drop their border to match.

  **Detail pages adopt InfoSection rows.** Contact, staff, and agent detail
  pages restructured around `InfoSection` + `InfoRow`, with native columns
  (email, phone, title, model, etc.) merged into the same surface as custom
  attributes — label-left, white card, tight rows.

  **Shared attribute primitives.** `AttributeTable` and `AttributeFieldControl`
  lifted to `src/components/attributes`; the contacts and team modules drop
  ~250 lines each of byte-near duplicate code in favor of 20-line bindings.
  Server values now merge per non-dirty key (rather than bailing when any field
  is dirty), and dirty entries whose definition has been removed upstream are
  dropped — so admin-side def deletions are no longer masked.

  **Drive section helper.** `DriveSection` consolidates the
  `DriveProvider` + `DriveBrowser` + fixed-height `InfoCard` triplet that the
  contact, staff, agent, and settings/account pages all repeated.

  **Design tokens + Tailwind defaults.** New foreground mix scale, shadow
  utility set, and z-index registry (`packages/template/src/styles`).
  `text-mini` / `text-compact` retired in favor of Tailwind's default text
  scale.

  **Settings consolidated to one page.** The `/settings/account` placeholder
  form is gone; the user-menu's top item is now a Profile link to the
  authenticated user's `/team/<userId>` detail page. The remaining tabs
  (Appearance, Notifications, API Keys) collapse into a single
  InfoSection-stack `/settings` page (no tabs), mirroring the contact-detail
  layout. `/settings` redirects to itself; the `account`, `profile`, `display`
  sub-routes are deleted along with their no-op POST endpoints
  (`/api/settings/account`, `/api/settings/appearance`, `/api/settings/display`).

  **Auto-save settings.** Notifications auto-save with a 400 ms debounce and a
  "Saving… → Saved → Save failed" indicator (toast on error). Theme + font
  size are now treated as client-only state (theme-provider + documentElement
  font-size) — no longer round-tripped through a stub server endpoint that
  swallowed the writes.

  **Real API keys.** The API Keys section was a placeholder POSTing to a
  no-op endpoint. It now goes through the existing `auth/api-keys` service
  (the same one that backs `cli-grant` for CLI device-grant auth):
  `GET /api/settings/api-keys` lists summaries (id, name, prefix•start,
  created, last-used), `POST` creates and returns the plaintext token once
  in a green reveal banner with a Copy button, `DELETE :id` revokes (and
  guards by ownership at the query). Tokens are sha256-hashed at rest and
  the `key` field is excluded from list responses (with a regression test).
  Created and last-used render via `RelativeTimeCard`.

  **Smaller polish.** Rail nav badge sizing (text-xs / h-5), Add web channel
  CTA size + 480px web preview track, redundant Drive list-page icon
  removed, list-page action button icons no longer force `mr-2 size-4`
  (`size=sm` slot spacing handles it).

## 3.1.0

### Minor Changes

- [`26f886c`](https://github.com/vobase/vobase/commit/26f886c3567ac1a85b4294efb3ecf1bd6dc805bf) Thanks [@mdluo](https://github.com/mdluo)! - Three connected changes to the template's agent-facing surface:

  **Audience tier model.** Verbs are now tagged with `audience: 'admin' | 'staff' | 'contact'`, and the AGENTS.md `## Commands` block + in-bash `vobase --help` filter to what the wake's tier can see. The wake's tier is derived from `(lane, triggerKind)`:

  | `(lane, triggerKind)`                                                        | tier        |
  | ---------------------------------------------------------------------------- | ----------- |
  | `conversation + inbound_message`                                             | `'contact'` |
  | `conversation + supervisor / approval_resumed / scheduled_followup / manual` | `'staff'`   |
  | `standalone + operator_thread / heartbeat`                                   | `'staff'`   |
  | `vobase` CLI binary with admin API key (outside the harness)                 | `'admin'`   |

  Per-tier verb tagging applied across `messaging`, `team`, `drive`, `contacts`, `schedules`, `agents`, `system`. `team list` / `team get` / `conv reassign` / `drive propose` are `'contact'`-tier (every wake sees them); `messaging show` / `messaging close` / `agents show` are `'staff'`; everything else (`install`, `drive cat`, `system/*`, etc.) defaults to `'admin'` and is hidden from wakes. Filtering happens at the surface (visibility), not at dispatch — the bash sandbox doesn't hard-reject admin-tier verbs today.

  **`add_note` extended with `mentions`; `conv ask-staff` removed.** The `vobase conv ask-staff` verb and the standalone `ask_staff` tool are deleted. Asking staff a question is now a parameter on `add_note`: pass `mentions: [<userId or displayName>, ...]` and the tool resolves each token against the staff roster, prepends `@DisplayName` tokens to the body, and writes `staff:<userId>` mention strings — the existing post-commit fan-out in `messaging/service/notes` enqueues a supervisor wake per mentioned staff. `conversationId` is now optional on `add_note` and defaults to the current wake's conversation; required only on standalone-lane wakes that need to leave a note on a different conversation. The mentions array is bounded (`maxItems: 16`, per-token `maxLength: 64`) and dedups same-staff references so neither `staff:u1` mentions nor `@Alice` body prefixes are duplicated.

  **AGENTS.md preview HTTP route + lane-aware scratch.** New `GET /api/agents/definitions/:id/agents-md?lane=<>&triggerKind=<>&supervisorKind=<>` route renders the AGENTS.md preamble the agent would see for a given lane variant, used by the agent-edit page's lane switcher. The Plate renderer for the preview was rewired to `BasicBlocksPlugin` + `BasicMarksPlugin` and now omits `remarkMdx` (which silently truncated AGENTS.md at the first JSX-like token, e.g. `<id>` / `<2k` / `<file>`). Cross-org guards added on all four `/definitions/:id*` handlers so a session-authenticated user from one org can't preview / read / mutate / delete another org's agent. The new `WakeAgentsMdScratch` (`wake/agents-md-scratch.ts`) carries `(lane, triggerKind, supervisorKind)` to module-side AGENTS.md contributors, replacing prose-in-instructions: messaging now contributes lane-aware blocks for supervisor-coaching, ask-staff-answer, and standalone-no-customer wakes. `MERIGPT_INSTRUCTIONS` was trimmed in `modules/agents/seed.ts` to remove the sections now framework-emitted (lane rules, MEMORY.md routing, supervisor-wake handling).

  Documentation: the template's `CLAUDE.md` "Agent harness" section now documents the canonical context names (`AgentContributions<WakeContext>` boot-time, `WakeContext` per-wake, "agent harness" as the informal term for `wake/`), the audience-tier derivation table, and a "Adding agent surfaces in a new module" recipe (declare `tools` / `materializers` / `agentsMd` / `roHints` on `agent.ts`; register verbs through `ctx.cli.register(...)` with the right `audience`).

## 3.0.0

### Major Changes

- Promote template-v2 to the default `@vobase/template`. The prior template is archived to `legacy/template-v1/` (frozen, pinned to `@vobase/core@0.33.0`).

  Breaking changes:

  - Imperative composition replaces declarative `vobase.config.ts`. Tenants customize storage / auth / channels by editing the template source.
  - WhatsApp env vars renamed from `WA_*` to `META_WA_*`.
  - Knowledge-base, automation, and integrations modules removed (use v1 if needed). Mastra removed; agents now run on `@mariozechner/pi-agent-core`.
  - Default dev DB DSN reverted to `:5432 / vobase`.
  - `STORAGE_KEY` for theme localStorage renamed; users see system-default theme on first load after upgrade.

  See `packages/template/CLAUDE.md` for the new module set and conventions.
