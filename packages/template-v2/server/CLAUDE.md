## server/

Why this folder exists: Vite scans only `src/`. Putting runtime code (pg, pg-boss, postgres, pi-agent-core, just-bash) under `src/` forces the browser bundler to resolve native drivers and breaks the build. `server/` is the hard Vite-exclusion line; nothing in here is ever imported from `src/` (enforced by `check:bundle`).

Path alias: `@server/*` → `server/*`. Never reach into another module's `schema.ts` or `service/` — go through a typed port in `server/contracts/*-port.ts`.
