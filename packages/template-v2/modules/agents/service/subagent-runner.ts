import { newWakeId, registerSubagent, type ToolContext, type ToolResult, unregisterSubagent } from '@vobase/core'

export interface SubagentRunInput {
  goal: string
  toolset: string[]
  maxTurns: number
  ctx: ToolContext
}

/**
 * Spawn a sub-agent under the parent's wake. Core's `registerSubagent`
 * enforces the max-depth invariant and the journal namespace; the template
 * is the seam where the actual `pi-agent-core` Agent lives. The current
 * implementation is still a stub — once the runtime spawn lands, the
 * `runChild()` block below is the only thing that changes.
 */
export function createSubagentRunner() {
  return function runSubagent(input: SubagentRunInput): Promise<ToolResult<{ summary: string }>> {
    const childWakeId = newWakeId()
    const wakeAbort = new AbortController()
    try {
      registerSubagent({
        parentWakeId: input.ctx.wakeId,
        childWakeId,
        goal: input.goal,
        abort: { wakeAbort, reason: null },
      })
    } catch (err) {
      return Promise.resolve({
        ok: false,
        error: err instanceof Error ? err.message : 'subagent: registration failed',
        errorCode: 'SUBAGENT_DEPTH',
        retryable: false,
      })
    }

    void input.toolset
    void input.maxTurns

    try {
      // Phase 2 stub — real pi-mono Agent spawn with restricted toolset lands later.
      const result: ToolResult<{ summary: string }> = {
        ok: true,
        content: { summary: `Subagent completed goal: ${input.goal}` },
      }
      return Promise.resolve(result)
    } finally {
      unregisterSubagent(input.ctx.wakeId, childWakeId)
    }
  }
}

/** Top-level runner used by `subagentTool.execute()`. */
export const runSubagent = createSubagentRunner()
