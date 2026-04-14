# Vobase Project

Scaffolded from [vobase](https://github.com/vobase/vobase) — an app framework built for AI coding agents. Bun + Hono + Drizzle + PostgreSQL.

## Quick Start

Requires [Bun](https://bun.sh) and Docker.

```bash
bun install
docker compose up -d   # Postgres (pgvector/pg17) + Maildev
bun run db:push        # sync schema
bun run dev            # Vite + Hono on watch
```

Open <http://localhost:5173>. Mail UI at <http://localhost:1080>.

## Layout

- `server.ts` — Hono entry; modules mount under `/api/{module}`
- `modules/` — business capabilities (each a `defineModule()` with schema, routes, jobs, pages)
- `src/` — React frontend (TanStack Router + shadcn/ui)
- `lib/` — shared utilities
- `vobase.config.ts` — core config (auth, storage, channels, integrations)
- `AGENTS.md` — conventions for AI coding agents working in this repo

## Common Commands

| Command | What it does |
| --- | --- |
| `bun run dev` | start dev server |
| `bun run build` | typecheck + generate routes |
| `bun test` | run tests |
| `bun run lint` | biome check |
| `bun run db:push` | sync schema to Postgres |
| `bun run db:studio` | browse data in Drizzle Studio |
| `bun run db:seed` | seed demo data |
| `bun run db:reset` | drop + recreate schema |

## More

- [Vobase docs](https://github.com/vobase/vobase)
- Project conventions: `AGENTS.md`
