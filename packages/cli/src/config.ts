/**
 * Local config loader for `@vobase/cli`.
 *
 * Configs live at `<dir>/.vobase/<name>.json` (default name: `config`). Each
 * config binds the CLI to one tenant deployment: `{ url, apiKey,
 * organizationId, principal }`. A developer juggling multiple tenants keeps
 * one file per tenant and switches via `--config=<name>` or
 * `VOBASE_CONFIG=<name>`. Files are written with `0600` permissions because
 * they hold an API key.
 *
 * Name resolution precedence (highest first):
 *   1. explicit `--config <name>` flag
 *   2. `VOBASE_CONFIG` env var
 *   3. literal `'config'` (default)
 *
 * File-location lookup for the resolved name (highest first — same shape as
 * `git`/`gh`/`kubectl` config discovery):
 *   1. `./.vobase/<name>.json` walking up from `cwd`, stopping at the repo
 *      root (a `.git` sibling) or `$HOME` — whichever comes first. Closest
 *      wins, so an agency operator can `cd client-acme && vobase ...` to
 *      target ACME's tenant without `--config` flags.
 *   2. `~/.vobase/<name>.json` — fallback for the single-tenant operator who
 *      doesn't want per-checkout configs.
 *
 * Pure existing-behavior callers (no `cwd`) still hit `~/.vobase/<name>.json`
 * unchanged.
 */

import { existsSync } from 'node:fs'
import { chmod } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { z } from 'zod'

export const ConfigSchema = z.object({
  url: z.string().url(),
  apiKey: z.string().min(1),
  organizationId: z.string().min(1),
  principal: z.object({
    id: z.string().min(1),
    email: z.string().email().optional(),
    name: z.string().optional(),
  }),
  /** Forward-compat discriminator. Absence (v0) or `1` (v1) both parse. */
  version: z.literal(1).optional(),
})

export type Config = z.infer<typeof ConfigSchema>

export interface ResolveConfigNameOpts {
  flag?: string
  env?: NodeJS.ProcessEnv
}

/** Resolve which config file to read. Pure; does no IO. */
export function resolveConfigName(opts: ResolveConfigNameOpts = {}): string {
  if (opts.flag && opts.flag.length > 0) return opts.flag
  const env = (opts.env ?? process.env).VOBASE_CONFIG
  if (env && env.length > 0) return env
  return 'config'
}

/** Build the absolute filesystem path for the *home-tier* config of a given name. */
export function configPath(name: string, home: string = homedir()): string {
  return join(home, '.vobase', `${name}.json`)
}

/** Build a *project-local* config path: `<dir>/.vobase/<name>.json`. */
export function localConfigPath(name: string, dir: string): string {
  return join(dir, '.vobase', `${name}.json`)
}

export interface LoadConfigOpts extends ResolveConfigNameOpts {
  home?: string
  /** Working directory the local-walk anchors on. Defaults to `process.cwd()`. */
  cwd?: string
}

/**
 * Yield each ancestor directory from `start` up to (and including) `home` or
 * the filesystem root, whichever comes first. Used by `findConfigPath` to walk
 * the project tree in search of `./.vobase/<name>.json`.
 */
function* walkUp(start: string, home: string): Generator<string> {
  let dir = start
  while (true) {
    yield dir
    if (dir === home) return
    const parent = dirname(dir)
    if (parent === dir) return
    dir = parent
  }
}

/**
 * Resolve the on-disk path of the config to load — local-first, with the
 * `~/.vobase/<name>.json` global as fallback. Returns `null` when neither
 * tier holds the named config (caller decides what to do, typically
 * "prompt the user to run `vobase auth login`").
 *
 * Local walk halts at:
 *   - the file (`./.vobase/<name>.json`) we were looking for — closest wins
 *   - a `.git` sibling — repo root, don't walk into the parent project
 *   - `$HOME` — without this we'd "discover" `~/.vobase/<name>.json` as
 *     project-local from any subdirectory of home, which would defeat
 *     `local: true` writes
 */
export async function findConfigPath(opts: LoadConfigOpts = {}): Promise<string | null> {
  const name = resolveConfigName(opts)
  const home = opts.home ?? homedir()
  const cwd = opts.cwd ?? process.cwd()

  for (const dir of walkUp(cwd, home)) {
    const local = localConfigPath(name, dir)
    if (await Bun.file(local).exists()) return local
    // `.git` may be a directory (normal repo) or a file (worktree); Bun.file's
    // `.exists()` returns false for directories, so use node:fs `existsSync`
    // which handles both.
    if (existsSync(join(dir, '.git'))) break
  }

  const global = configPath(name, home)
  if (await Bun.file(global).exists()) return global

  return null
}

/**
 * Read + validate the config for the current invocation.
 *
 * Returns `null` if no config file is found in either lookup tier (the
 * binary's auth-login flow uses this to prompt the user to log in). Throws on
 * schema mismatch — a malformed config is a real error the user must fix.
 */
export async function loadConfig(opts: LoadConfigOpts = {}): Promise<Config | null> {
  const path = await findConfigPath(opts)
  if (!path) return null
  const text = await Bun.file(path).text()
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`vobase: config at ${path} is not valid JSON: ${message}`)
  }
  const parsed = ConfigSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`vobase: config at ${path} is invalid: ${parsed.error.message}`)
  }
  return parsed.data
}

export interface WriteConfigOpts {
  name?: string
  home?: string
  /**
   * When true, write to `<cwd>/.vobase/<name>.json` (project-local) instead
   * of the home tier. Default false → `~/.vobase/<name>.json`. Reach for
   * `local: true` from `vobase auth login --local` so an agency operator can
   * keep per-checkout API keys without touching `--config <name>`.
   */
  local?: boolean
  /** When `local: true`, the cwd to anchor the project-local path on. Defaults to `process.cwd()`. */
  cwd?: string
}

/** Persist a config file with 0600 permissions. */
export async function writeConfig(config: Config, opts: WriteConfigOpts = {}): Promise<string> {
  const name = opts.name ?? 'config'
  const path = opts.local ? localConfigPath(name, opts.cwd ?? process.cwd()) : configPath(name, opts.home)
  const validated = ConfigSchema.parse(config)
  const text = `${JSON.stringify(validated, null, 2)}\n`
  await Bun.write(path, text)
  // Bun.write doesn't accept a mode option yet — chmod after write.
  await chmod(path, 0o600)
  return path
}
