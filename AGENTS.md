# AGENTS.md

Vobase is a full-stack TypeScript app framework built for AI coding agents — own-the-code scaffold with Bun, Hono, Drizzle, and module-based domain code.

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
| `@vobase/cli` | CLI helpers: `db:migrate` (bun-native), `add skill`, `dev` (deprecated — projects use drizzle-kit and scripts directly) |
| `create-vobase` | Project scaffolder (`bun create vobase my-app`) — downloads template via giget |
| `@vobase/template` | Scaffolding source for new projects (private, not published) |

## Stable Domain Concepts

- Module model: business capability is a module defined with `defineModule({ name, schema, routes, jobs?, pages?, seed? })`.
- Request context: use `getCtx(c)` to access `ctx.db`, `ctx.user`, `ctx.scheduler`, `ctx.storage`.
- Function types: use HTTP handlers for request/response logic and jobs for background execution.
- Routing model: module APIs mount under `/api/{module}`; MCP can be exposed on `/mcp`.
- Auth model: `better-auth` session-based auth with middleware-attached user context.
- Data model: Drizzle + SQLite (`bun:sqlite`), with safe-by-default patterns (integer money, explicit status transitions, auditable mutations).

Describe capabilities, not brittle file locations. Prefer domain language (module, handler, job, sequence, audit log, system module) over path-heavy instructions.

## Agent Workflow Defaults

- Search existing patterns before edits; mirror established naming and error handling.
- Keep changes small and local; avoid broad refactors unless required.
- Run validation for touched scope (`lint`, tests, typecheck/build when relevant).
- Do not install new dependencies or skills unless explicitly requested.

## Template Development

- `packages/template` is a workspace member for local dogfooding, but it is **only scaffolding material** — it has no migration history.
- The template must never contain generated artifacts (`migrations/`, `node_modules/`, `dist/`, `data/`, `routeTree.gen.ts`).
- To run the template locally in dev mode, use `bunx drizzle-kit push` to sync the schema to SQLite — do **not** generate or run Drizzle migrations.
- When `bun create vobase` scaffolds a new project, it downloads the template via giget and runs `bun install`.

## Template QA (Dogfooding)

### Dev Server Setup

```bash
# 1. Build core (template imports from dist)
bun run build --filter=@vobase/core

# 2. Sync schema to SQLite (no migrations in template)
cd packages/template && bunx drizzle-kit push

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

Delete `packages/template/data/` and re-run `bunx drizzle-kit push`.

### Post-Session Checklist

1. `bun run test` (all packages)
2. `bun run typecheck`
3. `bun run build`
4. Browser console clean on key pages

Optional deep references for workflow/tooling:

- Browser automation skill: `.agents/skills/agent-browser/SKILL.md`
- QA/dogfooding skill: `.agents/skills/dogfood/SKILL.md`
- Skill authoring workflow: `.agents/skills/skill-creator/SKILL.md`

## Design Context

### Users
Developers and small teams who use AI coding agents to build full-stack apps. They open `vobase init`, see the template, and immediately start building their domain. The UI is a tool, not a destination — it should feel fast, capable, and invisible until needed.

### Brand Personality
**Confident, pragmatic, direct.** Vobase knows what it is and doesn't apologize. No marketing fluff in the UI. Every element earns its place. The tone mirrors the README: "You own the code. You own the data. You own the infrastructure."

### Aesthetic Direction
- **Visual tone:** Clean, professional, neutral canvas. The template is a starting point, not a brand statement. Think Linear's density and taste — information-forward, keyboard-first feel, restrained use of color.
- **References:** Linear (clean density, tasteful color, fast feel).
- **Anti-references:** Generic SaaS templates (gradient heroes, stock illustrations, rounded-everything), AI-generated UI slop (cyan-on-dark, purple gradients, glassmorphism, glowing accents), Enterprise bloatware (dense nav trees, cluttered toolbars, gray-on-gray).
- **Theme:** Light + dark mode. Neutral gray palette with a single primary accent. OKLCH color model. No warm amber tones, no serif fonts, no decorative gradients.
- **Component system:** shadcn/ui with Base UI primitives (`base-nova` preset). Components managed via CLI (`bunx --bun shadcn@latest add`).

### Design Principles
1. **Earn every pixel.** No decoration without purpose. If a border, shadow, or color doesn't improve comprehension, remove it.
2. **Neutral by default.** The template is a canvas. Strong brand colors belong to the user's app, not the scaffold. Use one accent color sparingly.
3. **Density over sprawl.** Prefer compact, information-rich layouts. Whitespace should create rhythm, not fill space.
4. **Semantic over literal.** Use `bg-primary`, `text-muted-foreground` — never raw color values. The theme system handles light/dark; components should be color-agnostic.
5. **Own the components.** shadcn means the source is yours. Customize freely, but respect the Base UI primitive APIs.
