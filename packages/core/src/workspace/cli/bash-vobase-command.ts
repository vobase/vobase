/**
 * Build a `vobase` `just-bash` command backed by a `CliVerbRegistry`.
 *
 * Replaces the legacy `createVobaseCommand` (which iterated a flat
 * `CommandDef[]`). The new dispatcher is registry-driven: the same verbs the
 * runtime CLI binary serves over HTTP-RPC are also reachable from the wake's
 * bash sandbox via `createInProcessTransport`. One verb definition, two
 * transports — bash stdout for the agent, structured JSON for the binary.
 *
 * Argument parsing matches the binary CLI's resolver: `--key=value` and
 * `--flag` (boolean), with positional args collected under `_`. Strings are
 * coerced to numbers / booleans / arrays based on the verb's JSON-Schema
 * declaration (the registry's catalog cache pre-renders these). Verbs that
 * need stricter coercion can opt into `z.coerce.*` directly.
 */

import type { Command, ExecResult } from 'just-bash'
import { defineCommand } from 'just-bash'

import type { CliVerbDef } from './define'
import { renderBashHelp, renderBashResult } from './in-process-transport'
import type { CliVerbRegistry } from './registry'
import type { VerbContext, VerbTransport } from './transport'

export interface CreateBashVobaseCommandOpts {
  registry: CliVerbRegistry
  /** Per-wake context shared by every dispatched verb. */
  context: VerbContext
  /** Fires once per non-read-only verb. Used by the wake's "did-something" heuristic. */
  onSideEffect?: (verbName: string) => void
}

/** Parse `--key=value` / bare `--flag` / positional args into a flat input object. */
export function parseBashArgv(args: readonly string[]): Record<string, unknown> {
  const positional: string[] = []
  const out: Record<string, unknown> = {}
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq !== -1) {
        out[a.slice(2, eq)] = a.slice(eq + 1)
      } else {
        const next = args[i + 1]
        if (next === undefined || next.startsWith('--')) {
          out[a.slice(2)] = true
        } else {
          out[a.slice(2)] = next
          i += 1
        }
      }
    } else {
      positional.push(a)
    }
  }
  out._ = positional
  return out
}

/**
 * Coerce string-shaped flags into the JSON-Schema-declared types so
 * `z.number()` / `z.boolean()` schemas pass without `z.coerce.*` on every
 * verb. Mirrors the binary CLI's `coerceArgs`.
 */
export function coerceBashArgs(input: Record<string, unknown>, jsonSchema: unknown): Record<string, unknown> {
  if (!jsonSchema || typeof jsonSchema !== 'object') return input
  const schema = jsonSchema as { properties?: Record<string, { type?: string | string[] }> }
  if (!schema.properties) return input
  const out: Record<string, unknown> = { ...input }
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (!(key in out)) continue
    const raw = out[key]
    if (typeof raw !== 'string') continue
    const types = Array.isArray(prop.type) ? prop.type : prop.type ? [prop.type] : []
    if (types.includes('number') || types.includes('integer')) {
      const n = Number(raw)
      if (Number.isFinite(n)) out[key] = n
    } else if (types.includes('boolean')) {
      if (raw === 'true') out[key] = true
      else if (raw === 'false') out[key] = false
    } else if (types.includes('array')) {
      out[key] = raw.length === 0 ? [] : raw.split(',').map((s) => s.trim())
    }
  }
  return out
}

/** Find the verb whose name (split on whitespace) is the longest prefix of argv. */
function matchVerbInRegistry(
  argv: readonly string[],
  registry: CliVerbRegistry,
): { verb: CliVerbDef; nameTokens: number } | null {
  let best: CliVerbDef | null = null
  let bestTokens = 0
  for (const verb of registry.list()) {
    const tokens = verb.name.split(/\s+/u)
    if (tokens.length > argv.length) continue
    let matched = true
    for (let i = 0; i < tokens.length; i += 1) {
      if (tokens[i] !== argv[i]) {
        matched = false
        break
      }
    }
    if (matched && tokens.length > bestTokens) {
      best = verb
      bestTokens = tokens.length
    }
  }
  return best ? { verb: best, nameTokens: bestTokens } : null
}

export function createBashVobaseCommand(opts: CreateBashVobaseCommandOpts): Command {
  const { registry, context } = opts
  const transport: VerbTransport = {
    name: 'in-process',
    resolveContext: () => context,
    formatResult: (result) => result as object,
    recordEvent: (event) => {
      if (event.ok && event.readOnly !== true) opts.onSideEffect?.(event.verb)
    },
  }

  return defineCommand('vobase', async (args: string[]): Promise<ExecResult> => {
    if (args.length === 0 || args[0] === '--help' || args[0] === 'help') {
      return { stdout: renderBashHelp(registry.list()), stderr: '', exitCode: 0 }
    }
    const match = matchVerbInRegistry(args, registry)
    if (!match) {
      return {
        stdout: '',
        stderr: `vobase: unknown subcommand "${args[0]}". Run \`vobase help\` to list commands.\n`,
        exitCode: 1,
      }
    }
    const tail = args.slice(match.nameTokens)
    const parsed = parseBashArgv(tail)
    // Pull JSON-schema from the catalog so we don't re-derive per call.
    const catalogVerb = registry.catalog().verbs.find((v) => v.name === match.verb.name)
    const coerced = coerceBashArgs(parsed, catalogVerb?.inputSchema)
    const result = await registry.dispatch(match.verb.name, coerced, transport)
    return renderBashResult({ verbName: match.verb.name, result })
  })
}
