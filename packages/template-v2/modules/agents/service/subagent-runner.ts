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
 * implementation is still a stub — once the runtime spawn lands, replace
 * `runChild()` with the real harness invocation.
 *
 * `parentDepth` seeds the registry's parent depth — defaults to 0 (this
 * runner is invoked from a top-level wake). Tests pass `1` to simulate a
 * second-level call which should fail the depth guard.
 *
 * The runner is `async` so the eventual real spawn (which will await the
 * child harness) cannot accidentally let `unregisterSubagent` fire before
 * the child completes.
 */
export function createSubagentRunner(parentDepth = 0) {
  return async function runSubagent(input: SubagentRunInput): Promise<ToolResult<{ summary: string }>> {
    const childWakeId = newWakeId()
    const wakeAbort = new AbortController()
    registerSubagent({
      parentWakeId: input.ctx.wakeId,
      childWakeId,
      goal: input.goal,
      abort: { wakeAbort, reason: null },
      parentDepth,
    })

    void input.toolset
    void input.maxTurns

    try {
      return await runChild(input)
    } finally {
      unregisterSubagent(input.ctx.wakeId, childWakeId)
    }
  }
}

async function runChild(input: SubagentRunInput): Promise<ToolResult<{ summary: string }>> {
  return { ok: true, content: { summary: `Subagent completed goal: ${input.goal}` } }
}

/** Top-level runner used by `subagentTool.execute()`. */
export const runSubagent = createSubagentRunner()
