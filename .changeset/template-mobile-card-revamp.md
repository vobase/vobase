---
'@vobase/template': minor
---

End-to-end UI revamp of the template app: mobile-first shell, canonical layout
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
