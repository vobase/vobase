/**
 * VerbTransport — the adapter shape that lets the same verb body run identically
 * across in-process (pi-agent inside the wake), HTTP-RPC (standalone `vobase`
 * CLI binary), and future transports (MCP, etc.).
 *
 * Verb body is the function that *does the thing*. It receives a resolved
 * VerbContext (org, principal, scoped db handle / RPC client) and the parsed
 * input; it returns a structured result. The transport decides how the result
 * is rendered — stdout in the wake's bash sandbox, JSON-or-table on the CLI
 * binary's stdout, MCP tool response payload, etc.
 *
 * Test surface stays small: one body, two transports tested independently
 * with stubs.
 */
export interface VerbContext {
  organizationId: string
  /** Stable principal handle: a user id, an agent id, or an api-key principal. */
  principal: { kind: 'user' | 'agent' | 'apikey'; id: string }
  /** Optional active role; HTTP transport derives this from the api-key row. */
  role?: string
}

export type VerbResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string; errorCode?: string }

export type VerbFormat = 'human' | 'json' | 'structured'

/** Transport-emitted event for audit / side-effects (optional hook). */
export interface VerbEvent {
  verb: string
  transport: string
  durationMs: number
  ok: boolean
  errorCode?: string
}

export interface VerbTransport {
  /** Stable name: 'in-process' | 'http' | future: 'mcp', etc. */
  readonly name: string
  /** Resolves the per-call verb context from the transport-specific carrier
   *  (wake snapshot for in-process; api-key for HTTP). */
  resolveContext(): Promise<VerbContext> | VerbContext
  /** Renders the result for the transport's output channel. */
  formatResult(result: unknown, format: VerbFormat): string | object
  /** Optional audit / metrics hook. */
  recordEvent?(event: VerbEvent): void
}
