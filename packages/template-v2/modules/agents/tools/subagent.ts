import { Type } from '@mariozechner/pi-ai'
import { runSubagent } from '@modules/agents/service/subagent-runner'
import type { AgentTool, ToolContext } from '@server/contracts/tool'
import type { ToolResult } from '@server/contracts/tool-result'
import type { Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

export const SubagentInputSchema = Type.Object({
  goal: Type.String({ minLength: 1, description: 'Concrete focused goal for the sub-agent.' }),
  /**
   * Restricted toolset for the sub-agent. Defaults to `['bash']` so a spawned
   * sub-agent can navigate the virtual workspace out of the box.
   */
  toolset: Type.Optional(Type.Array(Type.String(), { default: ['bash'] })),
  maxTurns: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, default: 5 })),
})

export type SubagentInput = Static<typeof SubagentInputSchema>

function firstError(value: unknown): string {
  const first = Value.Errors(SubagentInputSchema, value).First()
  return first ? `${first.path || 'root'}: ${first.message}` : 'invalid input'
}

export const subagentTool: AgentTool<SubagentInput, { summary: string }> = {
  name: 'subagent',
  description:
    'Spawn an isolated sub-agent with a restricted toolset to accomplish a focused goal. Max recursion depth: 1.',
  inputSchema: SubagentInputSchema,
  parallelGroup: 'never',

  async execute(args, ctx: ToolContext): Promise<ToolResult<{ summary: string }>> {
    if (!Value.Check(SubagentInputSchema, args)) {
      return {
        ok: false,
        error: `Invalid subagent input — ${firstError(args)}`,
        errorCode: 'VALIDATION_ERROR',
      }
    }

    const toolset = args.toolset ?? ['bash']
    const maxTurns = args.maxTurns ?? 5

    try {
      return await runSubagent({ goal: args.goal, toolset, maxTurns, ctx })
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
