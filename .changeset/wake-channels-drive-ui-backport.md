---
'@vobase/template': patch
---

fix/feat(wake, messaging, channels, drive, ui): backport batch from downstream tenant

Ten changes rolled up from a production tenant where each was verified against
live agent traffic. Grouped by area:

## wake (staff-note safety)

1. **Customer-facing tools dropped on peer-consult wakes; self-anchor against
   duplicate sends.** Back-to-back `staff_note` wakes were re-firing the same
   customer card across multiple turns even when the cue said "do NOT call
   send_card" — soft instructions lost to in-context pattern pressure. When
   `triggerKind=staff_note` AND `assignee ≠ agent:<self>`, `reply` /
   `send_card` / `send_file` / `book_slot` are now dropped from the lane tool
   set (hard guarantee, filter propagates to both runtime registry and the
   AGENTS.md tool guidance). A new `selfActivity` snapshot in
   `wake/unread-activity.ts` renders agent-role messages and agent-authored
   self-notes since the last customer/staff inbound as "Your recent actions
   (already done, do not re-send)" in the cue appendix — gives the LLM a
   concrete "I already sent this" anchor for the agent-is-assignee case.
   `renderStaffNote` tightened in both branches.

2. **Default-deny customer tools on ALL staff_note wakes.** Soft constraints
   (prompt prose, self-anchor, cue text) repeatedly failed to break the
   dominant in-context pattern even when the agent had just self-noted that
   it would stay silent. Generalised the change above: `reply` / `send_card`
   / `send_file` / `book_slot` are now dropped for every `staff_note` wake,
   not just peer-consults. When staff genuinely want the agent to message the
   customer, they reply through the channel themselves (Reply composer) or
   wait for the next inbound. `renderStaffNote` unified around the new
   unconditional rule.

3. **`send_card` / `reply` prompts tightened.** Tool descriptions now spell
   out that they should NOT fire reflexively on every wake — only when the
   wake's actual ask warrants a customer-facing reply. Pairs with the
   default-deny gate above for staff_note wakes where the tool is also
   physically removed.

## messaging

4. **Legacy `book_slot` stub removed.** The placeholder tool returned
   `{slotId, confirmed: true}` without writing any appointment row, leading
   to hallucinated bookings the agent would confidently confirm in chat.
   References removed from `messaging.agent.ts` (tool roster + AGENTS.md
   prose), `wake/conversation.ts` default-deny set, `wake/trigger.ts`
   peer-consult + staff-note prose, and the e2e tool-surface fixture. The
   `agent_definitions.book_slot_approval_required` column is left intact
   (removing it needs a migration). `tests/e2e/system-hash-snapshot.test.ts`
   `SYSTEM_HASH_FIXTURE` will need refreshing on next run against the new
   tool surface.

## channels (whatsapp)

5. **Managed claim flow surfaces platform 4xx as `409`, not `502`.** Meta's
   platform-claim endpoint returns structured 4xx codes (number already
   claimed, app not approved, etc.); the adapter was bucketing all of them
   into 502 "upstream error", masking actionable failures from the UI.
   Pass-through now preserves the original status so the operator sheet
   shows the correct error.

6. **Staff-notification claim flow wired end-to-end.** The "staff is here,
   please notify them" claim path through WhatsApp managed channels now
   threads from inbound parse → claim handshake → realtime fanout, with
   factory + registry + bootstrap + handshake all updated. Connect-managed
   sheet UI shows the new state. Resolves the previously dangling case
   where the agent could request staff handoff but the notification never
   landed.

## drive

7. **Text-only rows unstick from "Indexing"; `drive upload --file=` works
   from remote tenants.** Two coupled bugs:
   - `writePath`, proposal-materializer's `upsertFile`, and seed inserts
     defaulted to `extraction_kind='pending'` and sat on the "Indexing"
     pulse forever (no bytes to extract). All three paths now land rows at
     `(ready, extracted)` via a shared `TEXT_WRITE_LIFECYCLE` constant in
     `drive/state.ts`; re-stamping on overwrite recovers any row a prior
     `reextract` flipped to `(failed, failed)`.
   - The legacy `drive upload --path=<local>` verb resolved the path on
     the SERVER's filesystem — broken for remote tenants. New
     `--file=<local-path>` flag reads on the operator's machine
     (`packages/cli` resolver base64-encodes + ships as `fileBytes` +
     `filename`); decoded server-side in the verb. `--path=<server-path>`
     retained for the agent's in-process bash sandbox.
   - `reextract` now refuses storage-keyless rows with an actionable error
     pointing at `drive write` / `drive propose` / `drive upload --file`.
   - `vobase-cli-ops` skill doc updated for the new convention (verb table,
     gotcha row, decision table, path-trap example).

## ui

8. **Drive sidebar brand reads from `VITE_PRODUCT_NAME`.** Was hardcoded
   to `'VOBASE'` — for white-label deployments it should match the same
   env var as the page title + auth layout. Falls back to `'Vobase'` when
   unset.

9. **Team member name inferred from email when not set; row stays
   clickable when name is empty.** New `auth/display-name.ts` helper
   threaded through the dev-plugin and the principal directory; the team
   list and detail page now degrade gracefully for rows where the
   `name` column was never populated.

10. **Markdown patch diffs wrap long lines.** `<DiffView>` was clipping
    long single-line patches off the right edge of the changes panel;
    `whitespace-pre-wrap` lets the line break at the panel width.
