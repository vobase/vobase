---
"@vobase/cli": minor
---

feat(cli): local-first hybrid config lookup with `--local` flag

`vobase` now resolves configs in the same shape as `git`/`gh`/`kubectl`: walks from `cwd` looking for `./.vobase/<name>.json`, halts at the repo root (a `.git` sibling) or `$HOME`, and falls back to `~/.vobase/<name>.json`. Closest match wins, so an agency operator can `cd client-acme && vobase ...` to target that tenant without `--config` flags.

- `vobase auth login --local` writes to `<cwd>/.vobase/<name>.json` (0600) instead of `~/.vobase/`. Pair with a project-level `.gitignore` entry for `.vobase/` (added to template + repo root).
- The catalog cache co-locates with whichever config was loaded (`./.vobase/foo.json` → `./.vobase/foo.cache.json`).
- New exports: `findConfigPath`, `localConfigPath`. `loadConfig` accepts a `cwd` opt; `writeConfig` accepts `local: true` + `cwd`. `CatalogClient` accepts `configFilePath` so the cache derives from the resolved path.
- Error message updated to surface both tiers and point at `--local`.
