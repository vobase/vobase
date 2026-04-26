/**
 * Command resolver for `@vobase/cli`.
 *
 * Given parsed argv (after global flags like `--config`, `--json`,
 * `--refresh` are stripped), the resolver:
 *
 *   1. Walks the catalog by longest-prefix match on the verb name —
 *      `vobase contacts list pending` first tries verb `'contacts list pending'`,
 *      then `'contacts list'`, then `'contacts'`.
 *   2. Parses positional + `--flag` args into a JSON-shaped input object
 *      (the server validates against the verb's Zod schema; the CLI's
 *      job is just to gather + shape).
 *   3. Dispatches to the verb's `route` via the HTTP-RPC transport.
 *   4. Renders the result through `formatResult`.
 *
 * Argument parsing is intentionally simple. JSON Schema → cac flag-decl
 * is a future enhancement; for now we accept `--key=value` pairs and
 * positional args under the catalog's documented patterns. Power users
 * always have `--json` for raw JSON input via stdin.
 */

import type { Catalog, CatalogVerb } from './catalog'
import { type Format, formatResult } from './output'
import { type HttpRpcResult, httpRpc } from './transport/http'

export interface ResolveOpts {
  argv: readonly string[]
  catalog: Catalog
  baseUrl: string
  apiKey: string
  format: Format
  /** Override fetch for tests. */
  fetcher?: typeof fetch
}

export interface ResolveResultOk {
  ok: true
  output: string
  statusCode: number
}

export interface ResolveResultErr {
  ok: false
  output: string
  exitCode: number
}

export type ResolveResult = ResolveResultOk | ResolveResultErr

/** Find the longest-prefix verb match in the catalog. */
export function matchVerb(
  argv: readonly string[],
  catalog: Catalog,
): { verb: CatalogVerb; argsConsumed: number } | null {
  let best: CatalogVerb | null = null
  let bestTokens = 0
  for (const verb of catalog.verbs) {
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
  return best ? { verb: best, argsConsumed: bestTokens } : null
}

/**
 * Parse `--key=value` and `--flag` and bare positional args into an input
 * object. Positional args are exposed under `_` so verb bodies can pluck
 * them by index. Bare `--flag` becomes `{ flag: true }`.
 *
 * Examples:
 *   `update u1 --segment=qualified` → `{ _: ['u1'], segment: 'qualified' }`
 *   `list --limit=10 --json`        → `{ _: [], limit: '10' }` (--json is global)
 */
export function parseArgs(args: readonly string[]): Record<string, unknown> {
  const positional: string[] = []
  const out: Record<string, unknown> = {}
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq !== -1) {
        out[a.slice(2, eq)] = a.slice(eq + 1)
      } else {
        // Look ahead for a value; if next token is also a flag or absent, treat as bool.
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

/** Resolve the verb, dispatch, and format. */
export async function resolve(opts: ResolveOpts): Promise<ResolveResult> {
  const match = matchVerb(opts.argv, opts.catalog)
  if (!match) {
    return {
      ok: false,
      output: `Unknown verb '${opts.argv.join(' ')}'. Run 'vobase --refresh' to update the catalog, or 'vobase --help' to list available verbs.\n`,
      exitCode: 1,
    }
  }
  const tail = opts.argv.slice(match.argsConsumed)
  const input = parseArgs(tail)

  const result = (await httpRpc({
    baseUrl: opts.baseUrl,
    apiKey: opts.apiKey,
    route: match.verb.route,
    body: input,
    fetcher: opts.fetcher,
  })) as HttpRpcResult<unknown>

  if (!result.ok) {
    if (result.errorCode === 'unauthorized') {
      return {
        ok: false,
        output: 'Authentication failed. Run `vobase auth login` to refresh.\n',
        exitCode: 2,
      }
    }
    return {
      ok: false,
      output: `vobase ${match.verb.name}: ${result.error || 'Request failed'}\n`,
      exitCode: 1,
    }
  }

  // Verb body returns either a raw value or `{ ok, data }` — accept both shapes.
  const payload = unwrapVerbResult(result.data)
  if (payload.ok) {
    return {
      ok: true,
      output: formatResult(payload.data, { format: opts.format, hint: match.verb.formatHint }),
      statusCode: result.statusCode,
    }
  }
  return {
    ok: false,
    output: `vobase ${match.verb.name}: ${payload.error}\n`,
    exitCode: 1,
  }
}

function unwrapVerbResult(value: unknown): { ok: true; data: unknown } | { ok: false; error: string } {
  if (value && typeof value === 'object' && 'ok' in value) {
    const v = value as { ok: unknown; data?: unknown; error?: unknown }
    if (v.ok === true) return { ok: true, data: v.data ?? null }
    if (v.ok === false) {
      return { ok: false, error: typeof v.error === 'string' ? v.error : 'Verb returned an error' }
    }
  }
  return { ok: true, data: value }
}
