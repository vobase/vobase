/**
 * createInProcessTransport — the canonical `'in-process'` VerbTransport used
 * inside the wake (the agent invokes a CLI verb directly without an HTTP hop)
 * and inside tests (cross-transport parity).
 *
 * The verb body is unchanged from any other transport — only the context
 * resolution and result rendering differ. In-process resolves the context
 * from the wake's frozen snapshot, captured once when the transport is
 * created. For human stdout, it prefers the verb's optional `summary` string
 * over the structured `data` blob; falling back to JSON keeps the bash
 * sandbox grep-friendly.
 *
 * `onSideEffect` is the wake-side hook the bash dispatcher used to use to
 * track "did this turn do something." Read-only verbs (those declared
 * `readOnly: true` on `defineCliVerb`) bypass the callback so a verb like
 * `team list` or `messaging show` doesn't flag the turn.
 */

import type { CliVerbDef } from './define'
import type { VerbContext, VerbEvent, VerbFormat, VerbTransport } from './transport'

export interface InProcessTransportOpts {
  context: VerbContext
  /** Optional event sink — wake harness routes these into the audit log. */
  recordEvent?: (event: VerbEvent) => void
  /** Fires once per non-read-only verb dispatched. Used by the wake to track "did-something". */
  onSideEffect?: (event: VerbEvent) => void
}

export function createInProcessTransport(opts: InProcessTransportOpts): VerbTransport {
  return {
    name: 'in-process',
    resolveContext: () => opts.context,
    formatResult: (result, format) => formatInProcess(result, format),
    recordEvent: (event) => {
      opts.recordEvent?.(event)
      if (event.ok && event.readOnly !== true) {
        opts.onSideEffect?.(event)
      }
    },
  }
}

/**
 * Format a verb's `{ data, summary? }` result for bash stdout.
 *
 *  - `format === 'structured'`: passthrough — pre-rendered object.
 *  - `format === 'json'`: pretty-printed JSON of the full result.
 *  - `format === 'human'` (default): if the verb populated `summary`, return
 *    that string verbatim (the bash dispatcher appends a trailing newline).
 *    Otherwise compact-JSON of `data` for grep-ability.
 */
function formatInProcess(result: unknown, format: VerbFormat): string | object {
  if (format === 'structured') return result as object
  if (format === 'json') return JSON.stringify(result, null, 2)
  if (typeof result === 'string') return result
  if (result && typeof result === 'object') {
    const r = result as { summary?: unknown; data?: unknown }
    if (typeof r.summary === 'string' && r.summary.length > 0) return r.summary
    if ('data' in r) return JSON.stringify(r.data)
  }
  return JSON.stringify(result)
}

/**
 * Render the per-bash-result envelope `{ stdout, stderr, exitCode }` callers
 * need when wrapping a registry dispatch into a `vobase` shell command. Pulled
 * out so template-side workspace builders share one body.
 */
export interface BashRenderArgs {
  verbName: string
  result: { ok: true; data: unknown; summary?: string } | { ok: false; error: string; errorCode?: string }
}

export interface BashRenderResult {
  stdout: string
  stderr: string
  exitCode: number
}

export function renderBashResult({ verbName, result }: BashRenderArgs): BashRenderResult {
  if (!result.ok) {
    return { stdout: '', stderr: `vobase ${verbName}: ${result.error}\n`, exitCode: 1 }
  }
  const out =
    typeof result.summary === 'string' && result.summary.length > 0
      ? result.summary
      : typeof result.data === 'string'
        ? result.data
        : JSON.stringify(result.data)
  return { stdout: out.endsWith('\n') ? out : `${out}\n`, stderr: '', exitCode: 0 }
}

/**
 * `vobase --help` body for the in-bash sandbox: lists verbs visible to the
 * `'in-process'` transport (audience `'all'` or `'agent'`). Centralised here
 * so the wake's bash command and any future "list available verbs" hook
 * share one implementation.
 */
export function renderBashHelp(verbs: readonly CliVerbDef[]): string {
  const visible = verbs.filter((v) => (v.audience ?? 'all') !== 'staff').sort((a, b) => a.name.localeCompare(b.name))
  if (visible.length === 0) return 'vobase: no commands registered\n'
  const lines = ['vobase subcommands:']
  for (const v of visible) {
    lines.push(`  vobase ${v.name.padEnd(30, ' ')} ${v.description ?? ''}`.trimEnd())
  }
  return `${lines.join('\n')}\n`
}
