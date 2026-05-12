---
'@vobase/template': patch
'@vobase/core': patch
'@vobase/cli': patch
'create-vobase': patch
---

# Tenant deploy back-ports from `a fresh tenant`

Three pre-existing template bugs that bricked every fresh tenant's first Railway deploy. Surfaced while bootstrapping `a fresh tenant`; fixes verified on its staging environment before being back-ported here. No tenant code is required to consume these — fresh deploys just work.

## Tenant template (`@vobase/template`)

### `scripts/db-migrate.ts` + `Dockerfile` — migrations actually run on Railway

- `scripts/db-migrate.ts` looked for `drizzle/meta/_journal.json`, a pre-1.0 drizzle-kit path that drizzle 1.0 no longer writes (journal lives in the `__drizzle_migrations` DB table). The check always failed → silent exit 0 → preDeployCommand `bun run db:migrate` claimed success without creating any tables. Now scans for any `drizzle/<ts>_<name>/migration.sql`, matching what `db:generate` actually produces.
- `Dockerfile` runtime stage didn't `COPY` the `drizzle/` directory, so even with correct detection the migration SQL wasn't present in the container. Added `COPY --from=build /app/drizzle ./drizzle` next to the other source dirs.

Combined, these two make `bun run db:migrate` on Railway preDeploy actually apply committed migrations. Without them every `/api/auth/*` route 500s on the first request because `auth.user` doesn't exist yet.

### `modules/channels/adapters/whatsapp/*` + `modules/team/service/staff-link-sync.ts` — outbound HMAC reaches the platform

- `handlers/managed.ts` (lines 65, 92), `factory.ts` (line 243), and `staff-link-sync.ts` (line 115) sent `VITE_PLATFORM_TENANT_SLUG` as `X-Tenant-Id`. The platform verifies by `tenants.id` (an immutable 12-char nanoid), not by slug, so verification always missed and the platform silently fell through to its anonymous `{ok: true}` response. The tenant then read that as an auth failure and returned 502 on every signed surface — `/api/channels/whatsapp/managed/availability`, sandbox claim, staff-link sync.
- Switched all four sites to `process.env.PLATFORM_TENANT_ID`, which the platform's provisioning job already stamps alongside `PLATFORM_TENANT_SLUG`. The slug stays where it legitimately belongs: `deriveVerifyToken` (both ends of the WhatsApp webhook verify derivation must agree on the slug) and per-managed-channel records keyed by `tenant_slug`.

## Workspace dependencies (`@vobase/core`, `@vobase/cli`, `create-vobase`)

- `drizzle-orm`/`drizzle-kit` aligned at `^1.0.0-rc.2` across `packages/template`, root, and `create-vobase` (`@vobase/core` was already there). Beta-era drizzle-kit produced a snapshot but never wrote `meta/_journal.json`, which is the bug that made the silent-skip path above so durable.
- Linked-packages config bumps `@vobase/core`, `@vobase/cli`, and `create-vobase` in lockstep with the dep alignment; no functional changes in those packages.

## Known follow-up (not blocking this change)

drizzle-kit `1.0.0-rc.2` generates invalid SQL for `tsvector GENERATED ALWAYS AS … STORED` columns in its `ALTER COLUMN` path, which trips `db:reset → drizzle-kit push` against `drive.chunks.tsv`. Pre-existing customType usage in `packages/template/modules/drive/schema.ts`. Tests that exercise `db:reset` are blocked on a separate fix (schema reshape or drizzle-kit patch); the deploy path here uses `db:migrate` and is unaffected.
