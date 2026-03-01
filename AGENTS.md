# AGENTS.md

Vobase is an AI-native, self-hosted ERP engine monorepo for building custom business systems with Bun, Hono, Drizzle, and module-based domain code.

## Essentials

- Package manager: `bun` (`packageManager: bun@1.3.10`)
- Workspace model: Bun workspaces + Turborepo (`packages/*`)
- Root commands:
  - `bun install`
  - `bun run dev`
  - `bun run build`
  - `bun run test`
  - `bun run lint`
  - `bun run typecheck`

Keep this root file small. Put detailed language rules, implementation recipes, and long workflows in linked docs (progressive disclosure).

## Monorepo Scope

| Package | Purpose |
| --- | --- |
| `@vobase/core` | Runtime engine: app wiring, modules, auth, ctx, jobs, MCP, storage |
| `@vobase/cli` | CLI and project scaffolding (`vobase init/dev/migrate/generate`) |

## Stable Domain Concepts

- Module model: business capability is a module defined with `defineModule({ name, schema, routes, jobs?, pages?, seed? })`.
- Request context: use `getCtx(c)` to access `ctx.db`, `ctx.user`, `ctx.scheduler`, `ctx.storage`.
- Function types: use HTTP handlers for request/response logic and jobs for background execution.
- Routing model: module APIs mount under `/api/{module}`; MCP can be exposed on `/mcp`.
- Auth model: `better-auth` session-based auth with middleware-attached user context.
- Data model: Drizzle + SQLite (`bun:sqlite`), with ERP-safe patterns (integer money, explicit status transitions, auditable mutations).

Describe capabilities, not brittle file locations. Prefer domain language (module, handler, job, sequence, audit log, system module) over path-heavy instructions.

## Agent Workflow Defaults

- Search existing patterns before edits; mirror established naming and error handling.
- Keep changes small and local; avoid broad refactors unless required.
- Run validation for touched scope (`lint`, tests, typecheck/build when relevant).
- Do not install new dependencies or skills unless explicitly requested.

## Template Development

- `packages/cli/template` is a workspace member for local dogfooding, but it is **only scaffolding material** — it has no migration history.
- The template must never contain generated artifacts (`migrations/`, `node_modules/`, `dist/`, `data/`, `routeTree.gen.ts`).
- To run the template locally in dev mode, use `bunx drizzle-kit push` to sync the schema to SQLite — do **not** generate or run Drizzle migrations.
- When `vobase init` scaffolds a new project, it copies the template and replaces `workspace:*` deps with real versions.

## Template QA (Dogfooding)

### Dev Server Setup

```bash
# 1. Build core (template imports from dist)
bun run build --filter=@vobase/core

# 2. Sync schema to SQLite (no migrations in template)
cd packages/cli/template && bunx drizzle-kit push

# 3. Start dev server
bun run dev  # backend :3000, frontend :5173
```

After changes to `@vobase/core`, rebuild before restarting the dev server.

### QA Protocol

Use `dogfood` or `agent-browser` skill for browser QA.

1. Open `http://localhost:5173/`
2. Sign up a new user (or log in if user exists)
3. Navigate system pages: `/system/logs` (audit log), `/system/list` (operations)
4. Exercise module pages — verify data loads, forms submit, tables render
5. Check browser console for errors throughout

### Data Reset

Delete `packages/cli/template/data/` and re-run `bunx drizzle-kit push`.

### Post-Session Checklist

1. `bun run test` (all packages)
2. `bun run typecheck`
3. `bun run build`
4. Browser console clean on key pages

Optional deep references for workflow/tooling:

- Browser automation skill: `.agents/skills/agent-browser/SKILL.md`
- QA/dogfooding skill: `.agents/skills/dogfood/SKILL.md`
- Skill authoring workflow: `.agents/skills/skill-creator/SKILL.md`
