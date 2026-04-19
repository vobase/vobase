import { runSubagent } from '@modules/agents/service/subagent-runner'
import type { AgentTool, ToolContext } from '@server/contracts/tool'
import type { ToolResult } from '@server/contracts/tool-result'
import { z } from 'zod'

const SubagentInputSchema = z.object({
  goal: z.string().min(1, 'goal must not be empty'),
  /**
   * Restricted toolset for the sub-agent. Defaults to `['bash']` so a spawned
   * sub-agent can navigate the virtual workspace out of the box (plan §P3.1).
   */
  toolset: z.array(z.string()).optional().default(['bash']),
  maxTurns: z.number().int().min(1).max(10).optional().default(5),
})

/** Input type — maxTurns is optional (defaults to 5 at parse time). */
export type SubagentInput = z.input<typeof SubagentInputSchema>

export const subagentTool: AgentTool<SubagentInput, { summary: string }> = {
  name: 'subagent',
  description:
    'Spawn an isolated sub-agent with a restricted toolset to accomplish a focused goal. Max recursion depth: 1.',
  inputSchema: SubagentInputSchema,
  parallelGroup: 'never',

  async execute(args, ctx: ToolContext): Promise<ToolResult<{ summary: string }>> {
    const parsed = SubagentInputSchema.safeParse(args)
    if (!parsed.success) {
      return {
        ok: false,
        error: 'Invalid subagent input',
        errorCode: 'VALIDATION_ERROR',
        details: parsed.error.issues,
      }
    }

    try {
      return await runSubagent({
        goal: parsed.data.goal,
        toolset: parsed.data.toolset,
        maxTurns: parsed.data.maxTurns,
        ctx,
      })
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'subagent failed',
        errorCode: 'SUBAGENT_ERROR',
        retryable: false,
      }
    }
  },
}
