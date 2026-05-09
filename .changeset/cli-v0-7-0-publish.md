---
"@vobase/cli": minor
"@vobase/core": minor
"create-vobase": minor
"@vobase/template": patch
---

CLI npm publish prep + audience-tier-filtered catalog + version-skew handshake.

**`@vobase/cli`** — first time the npm-installed binary is safe to use against any Vobase deployment.

- **Bun preflight** in `bin/vobase.ts` exits `127` with an install hint when invoked under non-Bun runtimes. Paired with `engines.bun: ">=1.3.13"` in `package.json` so npm/bun warn at install time. (Caveat: the friendly-hint path can't fire when imports fail to resolve — Node will die on `ERR_MODULE_NOT_FOUND` first. The `engines` field + shebang are the load-bearing guards.)
- **Auto-JSON on non-TTY** (BREAKING for pipelines that previously parsed the human table). Precedence: `--json` > `--no-json` > `!process.stdout.isTTY`. Pipe `vobase contacts list | jq` and you get JSON. Pass `--no-json` to keep table output even when piped.
- **Version-skew warning** — when the server advertises a newer `clientLatestVersion`, the binary prints `[vobase] WARN: vobase ${installed} is behind ${latest}; upgrade with 'bun add -g @vobase/cli'` to stderr **once per process**. No persisted state. No `clientMinVersion` hard-fail.
- **Optional `version: 1` discriminator** in `ConfigSchema` — forward-compat marker for future schema migrations. v0 configs (no `version` field) and v1 configs both parse cleanly. No migration code, no multi-tenant rewrites — `--config <name>` already provides multi-tenancy via filename.
- `prepublishOnly` script gates publish on `typecheck && test`. `files` array now ships `README.md` + `CHANGELOG.md`.

**`@vobase/core`** — catalog endpoint stops leaking admin-tier verbs to non-admin callers, and surfaces a one-line server-side handshake field for older CLI binaries.

- `CliVerbRegistry.catalogFor(tier: AudienceTier)` filters via the existing `isVerbVisible` helper and memoises one entry per tier (max 3). Cache invalidates inside `register()`. Existing `catalog()` is now a back-compat shim over `catalogFor('admin')` — same shape, same etag for that tier.
- `createCatalogRoute` is now generic over `Env`: `createCatalogRoute<TEnv>({ registry, getAudience?: (c: Context<TEnv>) => AudienceTier, clientLatestVersion?: string })`. `getAudience` defaults to `'admin'` so existing uninstrumented callers continue to see the unfiltered catalog. `clientLatestVersion` is included in the JSON body when set, omitted otherwise — older clients ignore unknown fields.
- Removed the separate `cachedCatalog` field; per-tier memo is the single source of truth. `list()` now caches its sorted result and clears in `register()`.

**`@vobase/template`** — wires `getAudience` from the API-key principal's role and pins `CLI_LATEST_VERSION = '0.7.0'` at the catalog mount site. Anonymous → `'contact'`, authed non-admin → `'staff'`, `role === 'admin'` → `'admin'`. The 401 from the api-key middleware still blocks anonymous before the route handler runs; the `'contact'` fallback is defense in depth.
