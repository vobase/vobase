/**
 * createInProcessTransport — the canonical `'in-process'` VerbTransport used
 * inside the wake (pi-agent invokes a CLI verb directly without an HTTP hop)
 * and inside tests (cross-transport parity).
 *
 * The verb body is unchanged from any other transport — only the context
 * resolution and result rendering differ. In-process resolves the context
 * from the wake's frozen snapshot, captured once when the transport is
 * created, and renders results as a JSON string for bash sandbox stdout.
 */

import type { VerbContext, VerbEvent, VerbFormat, VerbTransport } from './transport'

export interface InProcessTransportOpts {
  context: VerbContext
  /** Optional event sink — wake harness routes these into the audit log. */
  recordEvent?: (event: VerbEvent) => void
}

export function createInProcessTransport(opts: InProcessTransportOpts): VerbTransport {
  return {
    name: 'in-process',
    resolveContext: () => opts.context,
    formatResult: (result, format) => formatInProcess(result, format),
    recordEvent: opts.recordEvent,
  }
}

function formatInProcess(result: unknown, format: VerbFormat): string | object {
  if (format === 'structured') return result as object
  if (format === 'json') return JSON.stringify(result, null, 2)
  // 'human' — in-process bash sandbox, default to compact JSON for grep-ability.
  if (typeof result === 'string') return result
  return JSON.stringify(result)
}
