---
'@vobase/template': minor
---

# Automations module, magic-link auth, WhatsApp OTP

A single sustained release: the schedules subsystem grows up into a first-class **automations module** with a typed event bus, dispatcher, budget caps, and operator dashboard; better-auth gains a **magic-link plugin + WhatsApp OTP captor** so staff pings deep-link straight into a signed-in session; and the WhatsApp surface picks up self-serve verification, OTP login, and a 24-hour free-form routing path that cuts the WA bill by ~95% inside the customer-service window.

## Automations module

The old `modules/schedules` package handled cron rules and nothing else. It's been renamed to `modules/automations` and reshaped into the canonical event bus for the entire tenant:

- **Typed `emit(name, payload, { tx })`** — five events (`cron`, `staff-ping.required`, `automation.run-started`, `automation.run-finished`, `tenant-cost.daily-rolled`) cross seven producers (`messaging/service/notes`, `messaging/service/conversation`, `team/service/staff-ping`, `automations/service/cron-tick`, `automations/service/dispatcher`, `automations/service/budget-caps`, `automations/service/runs-prune`). A new `ts-morph`-backed `check:emit` AST scan in `scripts/check-emit.ts` is wired into `bun run check` and rejects any emit site outside that allowlist.
- **`automation_rules` + `automations` + `automation_runs` + `tenant_budget_caps`** — four tables under the new `automations` pgSchema. `automation_rules` is the rename target of `schedules.agent_schedules` (column-shape preserved); `automations` is the new event-driven rule table; `automation_runs` is the per-fire history; `tenant_budget_caps` enforces daily USD ceilings.
- **Dispatcher** — `dispatchEvent(name, payload, ctx)` resolves the matching rule rows, runs cooldown / pause / budget / verified-recipient gating, and enqueues either `agents:operator-thread-to-wake` (action.type=`wake`) or the WhatsApp staff-ping template send. Suppression reasons (`suppressed_cooldown`, `suppressed_paused`, `suppressed_budget`, `suppressed_unverified`) are first-class and surface on the dashboard.
- **Budget caps + budget watcher** — `tenant_budget_caps.daily_cap_usd` (INTEGER cents) is set via the `budget:set` CLI verb; `runBudgetWatcherTick` (currently unwired, pending agent assignment) re-checks daily cost every minute and, on breach, auto-pauses every rule that's flagged budget-eligible. The dispatcher rejects runs above the cap and records `suppressed_budget`.
- **`/automations` operator dashboard** — four widgets: cost / active-wakes / paused-rules / budget banner; per-rule table with pause + resume actions; active-wakes panel; 24h recent-runs table with per-wake cost from `harness.conversation_events`. Realtime invalidation fans `pg_notify` on `automations` + `automation_runs` + `tenant_budget_caps` into the matching TanStack Query keys.
- **CLI verbs** — `automations list/enable/disable/run` (in-process registry); `automations:pause` / `automations:resume` (HTTP-RPC dispatch behind admin auth); `budget:set` (clear or set cap in dollars).
- **Nightly retention** — `automations:runs-prune` recurring pg-boss job (3am UTC) DELETEs `automation_runs` older than the retention window; a dashboard placeholder row makes the sweep visible alongside live rules.

The new module is the **sole writer** for `automation_rules` / `automations` / `automation_runs` / `tenant_budget_caps`; `check:shape` rejects writes from anywhere else.

## Magic-link auth + WhatsApp OTP captor

Staff get clickable WhatsApp notifications that deep-link into a signed-in session instead of an email-OTP prompt.

- **`magicLink` better-auth plugin** (`auth/magic-link.ts`) — issues HMAC-signed `magicLinkToken` rows scoped to `(userId, organizationId, redirectPath, expiresAt)`. The `/api/auth/verify-magic-link` endpoint exchanges the token for a session and sets the active organization atomically. Replay-resistant (one-shot consumption), TTL-bound (5 minutes), and tied to a `trustedOrigins` allowlist.
- **Captor pattern** (`auth/captor.ts`) — extracted shared infrastructure for "internal call captures a nonce, external caller validates it". Used by both `mintMagicLink` and `mintPhoneOtp` so token issuance is the only path; the AST check `check:shape::mint-import-boundary` enforces that `mintMagicLink` is imported only from `team/service/staff-ping.ts`, `automations/service/admin-alert.ts`, and `automations/service/dispatcher.ts`.
- **`magicVerifyHmacPlugin`** (`auth/magic-verify-hmac.ts`) — exposes `/verify-magic-link` + `/set-active-organization` behind tenant HMAC. The platform calls these from the WA template button handler to issue a session token before redirecting the browser.
- **Per-kind notification templates** — `vobase_tenant_notification` (mentions), `vobase_approval_decision`, `vobase_proposal_decision`, `vobase_admin_alert` — each with its own redirect-path builder (`redirectPathFor` in `notification-template-payloads.ts`). Approval / proposal flows now ship a one-tap deep-link straight to the gated decision.
- **Dispatcher gating** — `metaTemplateApprovals` lookup on the integration row decides whether to send via `vobase_*` templates or fall through to free-form; rows missing approvals skip silently with `suppressed_unverified` rather than surfacing a Meta 132001.

## WhatsApp surface — verification, OTP login, 24h free-form

- **`phoneNumber.sendOTP` captor** wraps better-auth's stock plugin so OTPs go out through the platform's `vobase_platform_otp` template instead of an SMTP/SMS fallback.
- **Self-serve verification** — `writePhoneNumber` fires `mintPhoneOtp` fire-and-forget on every non-null phone change. `/_app` `beforeLoad` redirects unverified users to `/onboard/verify-phone?next=<original>` so deep-links survive the hop. Settings → Profile shows a "Verify WhatsApp" link + verified/unverified Status pill.
- **WhatsApp OTP login** — `/auth/login` gains a tabbed Email / WhatsApp UI; phone-mode signs the user in via `authClient.phoneNumber.verify` if the number matches an existing verified staff record. `signUpOnVerification` is intentionally off — unknown phones bounce, so the surface is restricted to staff already provisioned via email-OTP + invite.
- **Invite-accept via OTP** — `autoEnroll` checks for a pending invite *before* the existing-membership guard (case-insensitive `lower(email)` match), so an OTP login on an invited-but-unaccepted email enrols the membership without poisoning the `auth.invitation.status` flow. `session.create.before` now picks the most-recently-created org so multi-org joiners land in the new inbox.
- **`/onboard/verify-phone`** — DiceUI `OTPInput` + magic-link fallback. Invitation-accept paths thread `invitationId` through `/auth/pending` so OTP completion calls `authClient.organization.acceptInvitation` and redirects to the joined org's inbox.
- **24h free-form routing** — `sendNotificationTemplate` now branches on `checkWithin24h(db, organizationId, staffPhoneE164)`. Inside the WhatsApp 24h customer-service window the message ships via `/api/whatsapp/freeform` (rendered by `renderTemplateAsText`, `wireRoute: 'freeform'`, cost $0). A Meta `131047` rejection falls back to the template path with a distinct idempotency key (`wireRoute: 'freeform_fallback_template'`) so the platform's 5-minute dedup window doesn't suppress the retry. Outside the window the existing template path is used unchanged.

## New wake triggers

Five new `WakeTrigger` kinds (`mention_added`, `approval_resumed`, `proposal_decided`, `heartbeat`, `cron`) with deterministic renderers in `wake/trigger.ts`. The agents-side `pending_mention_pings` table is renamed to `pending_staff_pings` and gains soft-delete + a multi-kind discriminator (`mention` / `approval` / `proposal` / `admin_alert`). `pending-staff-pings-prune` cron sweeps claimed rows every 15 minutes. Cooldown helper (`cooldown.ts`) is shared across producers so the dispatcher, staff-ping, and admin-alert paths all honour the same suppression window.

## UI

- **Operator dashboard rename** — `/system/activity` → `/automations`. Nav label, route, page heading, and inner section subheading now all read consistently. Section title 'Automations' inside the page is now 'Rules' (the page itself is "Automations"). Activity icon → Workflow.
- **Pause-rule dialog** — replaces `window.prompt('Reason for pausing this rule?')` with a shadcn `Dialog` containing a `Textarea`, Cancel + Pause-rule buttons, and submit gating on non-empty reason.
- **Pending invitations card** — `/team` now shows pending org invitations above the staff roster with Resend (bumps `expiresAt`) and Revoke (AlertDialog-gated tombstone) actions. Realtime invalidation wired through `auth_invitation` pg_notify.
- **`PhoneNumberInput` shared component** — enforces E.164 via `E164_RE` on blur with inline error. Migrated four call sites: verify-phone, staff-form-dialog, invite-member-dialog, contact-form-dialog. Contacts handler also gains a Zod refinement so malformed numbers are rejected before the dispatcher ever sees them.
- **Notification timeline events** — `notification.sent` / `notification.suppressed` `conversation_events` render in the message-thread activity timeline with `BellRingIcon` / `BellOffIcon`, `PrincipalAvatar`, `RelativeTimeCard`.
- **Channels polish** — sandbox + notification onboarding merged into placeholder rows + single Connect dialog; placeholder Connect button right-aligned to match `ChannelRowMenu`; `whatsapp_notif` rows now route to the WhatsApp adapter menu; managed channels inherit display name from the platform pool row label and honour `defaultAssignee` on notification claim; UI sorts platform-managed rows last and gates Connect on pool availability.
- **Settings copy** — 'Operator agent' section → 'Automation defaults' with clearer descriptions of what the default-agent dropdown and scheduled-reviews toggle actually control.
- **Mention fan-out gating** — fan-out now reads `phoneNumberVerified` and falls back to email when unverified; the @-mention picker shows a warning badge for unverified staff.

## Bug fixes

- `auth.member` onConflictDoNothing had a target column on a non-existent UNIQUE; switched to no-target form (`28b3b0fe`).
- `session.create.before` was returning the first org row (stable across multi-org users); now orders `desc(createdAt)` so freshly-joined orgs are the active default (`28b3b0fe`).
- `channels/managed` webhook URL was using the literal string `'whatsapp'` instead of the channel name (`55b4c767`).
- `channels/ui` was routing `whatsapp_notif` rows to the wrong adapter menu (`0a49bf0c`).
- `channels/managed` notification claim ignored `defaultAssignee` (`e004825b`).
- `within-24h.test.ts` had a `null` vs `undefined` type mismatch on `insertLog.opts.from` (`dd870010`).

## Test coverage

Five new integration suites alongside the existing harness:

- `invitations-lifecycle.integration.test.ts` — list filtering, resend bump, revoke tombstone, org-scope leak guards, re-invite after revoke.
- `notification-events-fanout.integration.test.ts` — `notification.sent` / `notification.suppressed` event recording across staff-ping + dispatcher paths.
- `invite-acceptance-redirects-to-verify-phone.integration.test.ts` — 4 cases covering unverified accept, verified accept, stale pre-existing membership, deep-link bypass.
- `staff-phone-change-triggers-otp.integration.test.ts` — fire-and-forget OTP send on phone write.
- `within-24h.integration.test.ts` + companion routing suite — five wire-route scenarios (free-form within 24h, outside 24h, no prior inbound, Meta 131047 fallback, cross-key dedup).

US-012 magic-link integration coverage: replay rejection, signature tampering, multi-org token scoping, end-to-end browser → session.

`bun run check` (shape, bundle, emit, contract, error-shape, auth-schema, no-auto-nav-tabs, shadcn-overrides, trust-defaults) and `bun run typecheck` clean; full template test suite passes.

## Migration notes

- **`modules/schedules` → `modules/automations`** is a rename, not a wholesale rewrite. `automation_rules` preserves the `agent_schedules` column shape exactly; agent-defined cron rules continue to fire through the renamed `automations:cron-tick` job. The agent-visible tool name strings (`create_schedule`, `pause_schedule`) are preserved through the rename to protect existing `agent_definitions.skillAllowlist` rows + working memory; only the TypeScript exports moved (`createAutomationTool` / `pauseAutomationTool`).
- **Magic-link feature gates** — `metaTemplateApprovals` must be configured on the `integrations` row before the dispatcher will route notifications through the typed WA templates. Unconfigured orgs receive `suppressed_unverified` instead of a Meta failure.
- **`BETTER_AUTH_SECRET ≥ 32 chars`** is now load-bearing for HMAC-signed magic-link tokens in addition to the existing envelope-encryption keying.
