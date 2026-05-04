# @vobase/template

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
