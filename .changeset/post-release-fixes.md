---
"create-vobase": minor
"@vobase/core": patch
---

## create-vobase

### Agent skills download

Scaffolded projects now include the full vobase agent skills collection. During `bun create vobase`, skills are downloaded from the repo into `.agents/skills/` and symlinked into `.claude/skills/` so Claude Code discovers them automatically.

### Dynamic core schema resolution

`drizzle.config.ts` now uses `require.resolve('@vobase/core')` to find core schema paths dynamically. This fixes `db:push` failing in scaffolded projects where core lives in `node_modules` instead of `../core`.

## @vobase/core (patch)

### Dockerfile fixes

- Copy `patches/` and `stubs/` directories before `bun install` in both standalone and monorepo Dockerfiles — required for `patchedDependencies` and `better-sqlite3` resolution
- Remove Litestream from monorepo Dockerfile
- Remove `startCommand` from `railway.toml` (Dockerfile CMD handles startup)

### Template build fixes

- Fix `Bun.Glob` directory scanning: pass `onlyFiles: false` to include module directories in `generate.ts`
- Fix `ctx.user` possibly null errors: use non-null assertion in authenticated routes
- Remove leftover `.all()` call in `channel-handler.ts`
- Fix `JobOptions` properties: `delay` → `startAfter`, `retry`/`retries` → `retryLimit`
- Fix `@ts-expect-error` placement for optional `@azure/msal-node` import
- Add `postgres` dependency for `db-current.ts` production path
