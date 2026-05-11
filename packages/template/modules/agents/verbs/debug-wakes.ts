// Admin-tier: `triggerPayloadPreview` can leak inlined message bodies.
import { listWakes } from '@modules/agents/service/debug-readers'
import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

export const debugWakesVerb = defineCliVerb({
  name: 'agents debug wakes',
  description:
    'Wake-by-wake summary for a conversation: trigger, started_at, turns, tool calls, cost, system hash, end reason. Drill into a specific wake with `agents debug timeline --wakeId=<id>`.',
  usage: 'vobase agents debug wakes --conversationId=<id> [--limit=20] [--since=<iso>]',
  audience: 'admin',
  input: z.object({
    conversationId: z.string().min(1),
    limit: z.number().int().positive().max(100).default(20),
    since: z.string().datetime().optional(),
  }),
  body: async ({ input, ctx }) => {
    try {
      const rows = await listWakes({
        organizationId: ctx.organizationId,
        conversationId: input.conversationId,
        limit: input.limit,
        since: input.since ? new Date(input.since) : undefined,
      })
      return { ok: true as const, data: rows }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        errorCode: 'list_wakes_failed',
      }
    }
  },
  formatHint: 'table:cols=startedAt,wakeId,trigger,turns,toolCalls,costUsd,endReason,systemHash',
})
