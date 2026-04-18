/**
 * Typed envelope returned by every AgentTool. Spec §6.8.
 *
 * Large results spill to `/workspace/tmp/tool-<callId>.txt`; the `persisted` marker
 * tells the LLM to `cat` the path for full content.
 */
export type ToolResult<T = unknown> =
  | {
      ok: true
      content: T
      persisted?: { path: string; size: number; preview: string }
    }
  | {
      ok: false
      error: string
      errorCode?: string
      retryable?: boolean
      details?: unknown
    }

export type OkResult<T> = Extract<ToolResult<T>, { ok: true }>
export type ErrResult = Extract<ToolResult<never>, { ok: false }>
