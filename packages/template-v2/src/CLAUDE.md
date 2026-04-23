# src/ — frontend shell

This directory is for **cross-cutting, module-agnostic** frontend code only.

Module-specific UI lives in `modules/<module>/pages/`. Each module owns its full backend + frontend subtree — see `modules/CLAUDE.md`.

## What belongs here

- `components/ui/` — shadcn / DiceUI / ai-elements primitives (shared across every module)
- `components/layout/` — app shell, topbar, sidebar, list-detail layout
- `components/` (top-level) — generic, composable building blocks reused across modules (`approval-row`, `learning-proposal-row`, `message-card`, etc.)
- `hooks/` — generic React hooks not tied to a module (`use-keyboard-nav`, `use-realtime-invalidation`)
- `lib/` — generic utilities (`auth-client`, `api-client`, `utils`)
- `providers/` — app-wide React providers (query client, theme, search, etc.)
- `pages/` — **shell-only pages**: auth, errors, dev-only routes. Not for module pages.
- `styles/` — global CSS
- `routes.tsx` — route registry (imports from `@modules/<m>/pages/...`)
- `main.tsx`, `root.tsx`, `api-types.generated.ts`, `vite-env.d.ts`

## What does NOT belong here

- **Module-specific components.** If a component is only used by one module, it lives in `modules/<m>/pages/`. Do not create `src/features/<module>/` or `src/components/<module>/`.
- **Module-specific pages.** Even if the URL lives at the app root (e.g. `/messaging`), the page component lives in `modules/messaging/pages/` and is imported by `src/routes.tsx`.
- **Module-specific hooks or api clients.** A hook that calls `/api/messaging/*` lives in `modules/messaging/pages/api/`, not `src/hooks/`.
- **Backend-only code.** `src/**` must never import `@server/runtime/*` or `@server/harness/*`. Enforced by `bun run check:bundle`.

## The test

Before putting something in `src/`, ask: *would a second, unrelated module also use this exactly as-is?*

- Yes → `src/` is correct.
- No → it belongs in the owning module's `pages/` directory.

If in doubt, put it in the module. It's always cheaper to promote a file up into `src/` once a second consumer shows up than to hunt down module-specific code scattered across `src/`.

## Exceptions (currently)

- `src/pages/channels.tsx` — temporarily here. The channel adapters reorg (`modules/channel-*` → `modules/channels/*`) has landed; relocating this page to the `settings` module or a channel-specific pages dir is a follow-up task.
