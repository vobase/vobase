#!/usr/bin/env bun
/**
 * `vobase` CLI entry point. cac handles global flags (--config / --json /
 * --refresh / --help); verbs are catalog-driven and never registered with
 * cac. Auth subcommands intercept before catalog fetch (no-config case).
 */

import { cac } from 'cac'

import { CatalogClient } from '../src/catalog'
import { login, logout, whoami } from '../src/commands/auth'
import { loadConfig, resolveConfigName } from '../src/config'
import { renderGlobalHelp, renderGroupHelp } from '../src/help'
import { resolve as resolveVerb } from '../src/resolver'

interface CliFlags {
  config?: string
  json?: boolean
  refresh?: boolean
  help?: boolean
  url?: string
  token?: string
}

async function runAuth(sub: string, flags: CliFlags): Promise<number> {
  const configName = resolveConfigName({ flag: flags.config })
  if (sub === 'login') {
    const r = await login({ configName, url: flags.url, token: flags.token })
    return r.exitCode
  }
  if (sub === 'whoami') {
    const r = await whoami({ configName })
    return r.exitCode
  }
  if (sub === 'logout') {
    const r = await logout({ configName })
    return r.exitCode
  }
  process.stderr.write(`vobase auth: unknown subcommand "${sub}". Try login | whoami | logout.\n`)
  return 2
}

async function run(verb: readonly string[], flags: CliFlags): Promise<number> {
  const configName = resolveConfigName({ flag: flags.config })

  if (verb[0] === 'auth' && verb[1]) {
    return await runAuth(verb[1], flags)
  }

  const config = await loadConfig({ flag: flags.config })
  if (!config) {
    if (flags.help && verb.length === 0) {
      process.stdout.write(renderGlobalHelp({ etag: '', verbs: [] }))
      return 0
    }
    process.stderr.write(
      `vobase: no config found at ~/.vobase/${configName}.json. Run 'vobase auth login --url <tenant>' to set one up.\n`,
    )
    return 2
  }

  const client = new CatalogClient({ configName, baseUrl: config.url, apiKey: config.apiKey })

  let catalog: Awaited<ReturnType<CatalogClient['load']>>
  try {
    catalog = await client.load({ refresh: flags.refresh ?? false })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`vobase: ${message}\n`)
    return 1
  }

  if (verb.length === 0 || flags.help) {
    if (verb.length > 0) {
      process.stdout.write(renderGroupHelp(catalog, verb[0]))
    } else {
      process.stdout.write(renderGlobalHelp(catalog))
    }
    return 0
  }

  const result = await resolveVerb({
    argv: verb,
    catalog,
    baseUrl: config.url,
    apiKey: config.apiKey,
    format: flags.json ? 'json' : 'human',
    flags: flags as unknown as Record<string, unknown>,
  })

  if (result.ok) {
    process.stdout.write(result.output)
    return 0
  }
  process.stderr.write(result.output)
  return result.exitCode
}

const cli = cac('vobase')

cli
  .command('[...verb]', 'Run a vobase verb (catalog-driven)')
  .option('--config <name>', "Use ~/.vobase/<name>.json (default: 'config'); also VOBASE_CONFIG")
  .option('--json', 'Output raw JSON instead of human-readable format')
  .option('--refresh', 'Force-refetch the verb catalog')
  .option('--help', 'Show catalog-driven help (verb groups + verbs)')
  .option('--url <url>', 'Tenant base URL (auth login only)')
  .option('--token <key>', 'API key for headless login (auth login only)')
  // Verb-specific flags (e.g. --limit, --scope) are catalog-driven and
  // forwarded to the resolver via flags[name]; cac must not reject them.
  .allowUnknownOptions()
  .action(async (verb: string[], flags: CliFlags) => {
    const exitCode = await run(verb, flags)
    process.exit(exitCode)
  })

try {
  cli.parse(process.argv, { run: false })
  await cli.runMatchedCommand()
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  process.stderr.write(`vobase: ${message}\n`)
  process.exit(1)
}
