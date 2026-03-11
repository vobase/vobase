# create-vobase

Scaffold a new [Vobase](https://github.com/vobase/vobase) project — the app framework built for AI coding agents.

## Usage

```bash
bun create vobase my-app
cd my-app
bun run dev
```

This downloads the latest template from GitHub, installs dependencies, and gives you a working full-stack app with auth, database, storage, and jobs.

## What you get

```
my-app/
  server.ts           ← Hono + bun:sqlite entry point
  vite.config.ts      ← React + TanStack Router frontend
  drizzle.config.ts   ← SQLite schema management
  modules/            ← your domain code goes here
  src/                ← frontend (React, shadcn/ui)
  .agents/skills/     ← AI agent knowledge packs
```

Backend on `:3000`, frontend on `:5173`. Ships with a dashboard and audit log viewer.

## License

MIT
