# Dogfood Plan — template-v2 PR-2

Written at σ1 so gate criteria are established before the dogfood pass begins.

## Severity Rubric

| Severity | Merge policy | Examples |
|---|---|---|
| **P0** | Hard blocker — do not merge | Data loss; security hole; auth bypass; broken prod critical path (login, inbox load, `/reply` dispatch); corrupt DB state |
| **P1** | Hard blocker — fix before merge | Crashes or uncaught exceptions; 500s on main flows; theme toggle broken; settings submit failures; keyboard shortcuts non-functional; breadcrumb crashes; SSE missing NOTIFY |
| **P2** | Follow-up issue (file + link in PR description) | Visual polish; secondary flow bugs (sign-out dialog edge cases, error page copy); minor a11y; FOUC in Firefox / Safari only; layout overflow on narrow viewports |
| **P3** | Follow-up issue (file + link in PR description) | Edge-case UX; micro-interaction polish; non-obvious keyboard shortcut discovery; cosmetic dark-mode inconsistencies |

---

## Golden-Path Checklist

Run this checklist manually (dogfood agent + browser) at σ6, after all parcels land.

### 0. Setup

- [ ] `docker compose up -d` — Postgres healthy on 5433
- [ ] `bun run db:reset` — clean seed state
- [ ] `bun run dev` — server + Vite both start, no console errors
- [ ] Open `http://localhost:3001` in Chrome and Firefox

### 1. Auth flow

- [ ] `/login` renders correctly in light and dark mode
- [ ] Enter valid credentials → OTP pending page appears
- [ ] OTP entry → redirect to inbox
- [ ] Invalid OTP → error state, retry works
- [ ] Sign out via SignOutDialog → redirect to `/login`
- [ ] Back button after sign-out → stays on `/login` (no ghost session)

### 2. Inbox — conversation list

- [ ] Inbox loads seeded conversations, correct count
- [ ] Filtering by status (open / awaiting-approval / closed) works
- [ ] Keyboard shortcut `J` / `K` navigates conversation list
- [ ] Clicking a conversation opens conversation view

### 3. Inbox — conversation view

- [ ] Message thread renders correctly for text and card messages
- [ ] Staff reply via input box → message appears in thread
- [ ] POST `/reply` → SSE NOTIFY → thread updates without page reload
- [ ] Internal note creation → note appears with correct styling
- [ ] Reassign conversation → assignee updates in header

### 4. Settings — all 6 subpages

- [ ] `/settings/profile` — loads, form saves without 500
- [ ] `/settings/workspace` — loads, form saves without 500
- [ ] `/settings/team` — loads, member list renders
- [ ] `/settings/channels` — loads, channel cards render
- [ ] `/settings/integrations` — loads, integration list renders
- [ ] `/settings/billing` — loads, plan info renders
- [ ] Navigation between subpages via SubNav — active state correct

### 5. Theme toggle

- [ ] Light → Dark → System → Light cycle via dropdown, no flash
- [ ] Refresh preserves selected theme (localStorage)
- [ ] System mode follows OS dark/light preference in real time
- [ ] Theme applies immediately (no FOUC on hard reload)

### 6. Keyboard shortcuts

- [ ] `⌘K` / `Ctrl+K` opens command palette
- [ ] `G I` navigates to inbox
- [ ] `G S` navigates to settings
- [ ] `Esc` dismisses dialogs and dropdowns

### 7. Error pages

- [ ] Navigate to unknown route → 404 page renders
- [ ] 404 page has "Go back" / home link that works

### 8. CI gates (automated, run before dogfood)

- [ ] `bun run typecheck` → 0 errors
- [ ] `bun run lint` → 0 errors
- [ ] `bun run check:tokens` → both palettes pass
- [ ] `bun run check:no-raw-date` → 0 violations
- [ ] `bun run check:shape` → 0 errors
- [ ] `bun run check:bundle` → 0 errors
- [ ] `bun run smoke:staff-reply` → passes (σ5 gate)
- [ ] `bun test src/__tests__/theme-provider.test.ts` → all pass

---

## Reporting

For each finding, file a GitHub issue with:
- Severity label (P0 / P1 / P2 / P3)
- Steps to reproduce
- Expected vs actual behaviour
- Screenshot / recording if visual

P0 and P1 issues block the PR merge. P2 and P3 are linked in the PR description as known follow-ups.
