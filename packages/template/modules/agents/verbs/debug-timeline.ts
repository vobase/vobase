// Admin-tier: content/payload/toolCalls.arguments can include customer PII.
import { listTimeline } from '@modules/agents/service/debug-readers'
import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

export const debugTimelineVerb = defineCliVerb({
  name: 'agents debug timeline',
  description:
    'Per-wake event timeline (turn_start, message_*, tool_dispatch_*, tool_execution_*, llm_call, agent_end). Reveals the exact tool-call sequence per turn — useful for "did the agent skip the file read?" / "is it looping?" / "where did the cost go?" investigations.',
  usage: 'vobase agents debug timeline --wakeId=<id> [--full]',
  audience: 'admin',
  input: z.object({
    wakeId: z.string().min(1),
    full: z.boolean().default(false),
  }),
  body: async ({ input, ctx }) => {
    try {
      const rows = await listTimeline({
        organizationId: ctx.organizationId,
        wakeId: input.wakeId,
        full: input.full,
      })
      return { ok: true as const, data: rows }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        errorCode: 'list_timeline_failed',
      }
    }
  },
  formatHint: 'table:cols=ts,type,role,turnIndex,toolName,contentPreview',
})
