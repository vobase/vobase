---
name: list-page
description: |
  Bespoke per-module list page pattern using DiceUI DataTable + useDataTable + nuqs URL state + RelativeTimeCard for dates + module-typed Hono RPC for rows. Use this skill when adding a new top-level list page (e.g., `/widgets`, `/orders`) inside a vobase module, or when refactoring an old free-form list view into the standard data-table layout. Also use when the user says "list page", "make a table for X", "data table for module Y", "filter pills for the list", or "URL-shareable filters".
---

# List page (bespoke DataTable)

Slice 1 of `external-cli-and-collapse-shell` retired the saved-views meta-schema and the generic `<ViewRenderer>` runtime. Lists are now per-module with bespoke `<DataTable>` pages — every page owns its columns, filters, query keys, and server endpoint. The five filter pills, three sort options, and two columns the page uses are checked into source as React; nothing is reconciled at boot, nothing is reflected through a generic table renderer.

## When to apply

- Any new top-level list route (`/contacts`, `/messaging`, `/agents`, `/schedules`, …).
- Replacing a card-list, ad-hoc grid, or `<ViewRenderer>` callsite with a structured table.

Skip when the underlying data is genuinely small + static (≤20 rows, no filters) — a plain unordered list or `<table>` with `RelativeTimeCard` is fine.

## Canonical example

`packages/template-v2/modules/contacts/pages/index.tsx` is the reference implementation. Read that file first; this skill summarizes the load-bearing parts.

## Stack

- **DataTable + DataTableToolbar** from DiceUI (`bunx shadcn@latest add "https://diceui.com/r/data-table.json"`)
- **`useDataTable`** owns URL state via nuqs (`?page=2&filters[segments]=qualified,vip&sort=createdAt.desc`)
- **TanStack Query** keys are derived from the URL params, so URL change ⇒ query refetch
- **Module-typed Hono RPC** (`contactsClient`, `messagingClient`, …) for row fetches; **never** raw `fetch` in `src/**` (banned by `no-raw-fetch.grit`)
- **`<RelativeTimeCard date={...}>`** for any date column — auto-updating, i18n-safe, hover for full timestamp

## Server side

A list endpoint receives the URL params, validates with Zod, runs filters through Drizzle, and returns `{ rows, pageCount }`. Use `filterColumns()` from the `data-table` skill's reference if you need full server-side filtering; for simple lists, hand-roll the predicates.

## Filter rails

Hardcoded React arrays — not metadata. Slice 1's `<InboxFilterRail>` precedent: `Active | Later | Done` baked into the component, no DB lookup, no saved-view round-trip. New filter? Edit the source.

## What to avoid

- Don't introduce a generic `<ViewRenderer scope="…">` again. Pages own their tables.
- Don't reach for a YAML view definition or `defineViewable()` — both are gone.
- Don't write `new Date(value).toLocaleString()` — wrap with `<RelativeTimeCard date={value} />`.
- Don't bypass the typed RPC client; a raw `fetch('/api/…')` will fail the `check:bundle` lint and produce untyped responses.
