#!/usr/bin/env bun
/**
 * `vobase` — entry point for the @vobase/cli binary.
 *
 * Global flag parsing (`--config`, `--json`, `--refresh`) goes through cac so
 * `vobase --help` ergonomics (typo suggestions, version banner, formatting)
 * come for free. Verb-level dispatch is intentionally NOT registered with
 * cac — verbs are catalog-driven, not statically known. cac's "default
 * command + variadic args" pattern lets us collect the unparsed verb tail
 * and hand it off to the resolver.
 *
 * Auth verbs (`vobase auth login|whoami|logout`) intercept *before* the
 * catalog fetch because they handle the no-config-yet case. Slice 2b
 * implements them; in 2a they print "not yet implemented" so the surface
 * is in place.
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
      `vobase: no config found at ~/.vobase/${configName}.json. Run 'vobase auth login --url <tenant>' to set one up (Slice 2b).\n`,
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
