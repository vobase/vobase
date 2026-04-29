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
  /**
   * Wake-scoped context populated by the in-process transport when the verb
   * fires from inside a wake's bash sandbox. Verbs that bind to a specific
   * conversation (`conv reassign`, `conv ask-staff`, `drive propose`) read
   * `wake.conversationId` instead of taking the id as input. Absent on
   * HTTP-RPC dispatches; verbs that depend on it must validate presence and
   * return a typed error otherwise.
   */
  wake?: {
    conversationId: string
    contactId: string
    channelInstanceId?: string
    wakeId: string
    turnIndex: number
  }
}

export type VerbResult<T = unknown> =
  | { ok: true; data: T; summary?: string }
  | { ok: false; error: string; errorCode?: string }

export type VerbFormat = 'human' | 'json' | 'structured'

/** Transport-emitted event for audit / side-effects (optional hook). */
export interface VerbEvent {
  verb: string
  transport: string
  durationMs: number
  ok: boolean
  errorCode?: string
  /**
   * Mirrors the verb's `readOnly` flag — the in-process transport's
   * `onSideEffect` handler ignores events where this is true so the wake's
   * "did-something" heuristic doesn't fire for pure reads (`team list`,
   * `messaging show`, etc.).
   */
  readOnly?: boolean
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
