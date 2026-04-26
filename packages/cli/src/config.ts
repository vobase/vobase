/**
 * Local config loader for `@vobase/cli`.
 *
 * Configs live at `~/.vobase/<name>.json` (default name: `config`). Each
 * config binds the CLI to one tenant deployment: `{ url, apiKey,
 * organizationId, principal }`. A developer juggling multiple tenants keeps
 * one file per tenant and switches via `--config=<name>` or
 * `VOBASE_CONFIG=<name>`. Files are written with `0600` permissions because
 * they hold an API key.
 *
 * Resolution precedence (highest first):
 *   1. explicit `--config <name>` flag
 *   2. `VOBASE_CONFIG` env var
 *   3. literal `'config'` (default)
 */

import { chmod } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
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

/** Build the absolute filesystem path for a given config name. */
export function configPath(name: string, home: string = homedir()): string {
  return join(home, '.vobase', `${name}.json`)
}

export interface LoadConfigOpts extends ResolveConfigNameOpts {
  home?: string
}

/**
 * Read + validate the config for the current invocation.
 *
 * Returns `null` if the file doesn't exist (the binary's auth-login flow
 * uses this to prompt the user to log in). Throws on schema mismatch — a
 * malformed config is a real error the user must fix manually.
 */
export async function loadConfig(opts: LoadConfigOpts = {}): Promise<Config | null> {
  const name = resolveConfigName(opts)
  const path = configPath(name, opts.home)
  const file = Bun.file(path)
  if (!(await file.exists())) return null
  const text = await file.text()
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
}

/** Persist a config file with 0600 permissions. */
export async function writeConfig(config: Config, opts: WriteConfigOpts = {}): Promise<string> {
  const path = configPath(opts.name ?? 'config', opts.home)
  const validated = ConfigSchema.parse(config)
  const text = `${JSON.stringify(validated, null, 2)}\n`
  await Bun.write(path, text)
  // Bun.write doesn't accept a mode option yet — chmod after write.
  await chmod(path, 0o600)
  return path
}
