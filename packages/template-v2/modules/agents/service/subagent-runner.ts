import type { ToolContext } from '@server/contracts/tool'
import type { ToolResult } from '@server/contracts/tool-result'

export interface SubagentRunInput {
  goal: string
  toolset: string[]
  maxTurns: number
  ctx: ToolContext
}

/**
 * Creates a depth-scoped subagent runner. Pass `depth=0` for top-level callers;
 * inner agents receive `createSubagentRunner(depth + 1)` to enforce max depth=1
 * (second-level subagent call errors synchronously).
 */
export function createSubagentRunner(depth = 0) {
  return async function runSubagentScoped(input: SubagentRunInput): Promise<ToolResult<{ summary: string }>> {
    if (depth >= 1) {
      throw new Error('subagent: max depth 1 exceeded — nested subagents are not supported')
    }

    // Phase 2 stub — real pi-mono Agent spawn with restricted toolset lands in P2.7
    void input.toolset
    void input.maxTurns

    return { ok: true, content: { summary: `Subagent completed goal: ${input.goal}` } }
  }
}

/** Top-level runner used by subagentTool.execute(). */
export const runSubagent = createSubagentRunner(0)
