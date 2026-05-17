/**
 * `vobase automations:resume --ruleId=<id>`
 *
 * Symmetric to `automations:pause` — re-arms a paused rule. Service write
 * routes through `automationsService.resumeRule` (sole writer).
 */

import { automationsService } from '@modules/automations/service/automations'
import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

export const automationsResumeVerb = defineCliVerb({
  name: 'automations:resume',
  description: 'Resume a paused automation rule. Fires resume immediately on the next matching event.',
  audience: 'staff',
  input: z.object({
    ruleId: z.string().min(1),
  }),
  body: async ({ input, ctx }) => {
    if (ctx.principal.kind === 'agent') {
      return { ok: false as const, error: 'agents cannot resume rules', errorCode: 'forbidden' }
    }
    const rule = await automationsService.getRuleById(input.ruleId)
    if (!rule || rule.organizationId !== ctx.organizationId) {
      return { ok: false as const, error: `rule not found: ${input.ruleId}`, errorCode: 'not_found' }
    }
    await automationsService.resumeRule(input.ruleId, {
      actor: { id: ctx.principal.id, kind: 'user' },
    })
    return {
      ok: true as const,
      data: { ruleId: input.ruleId, paused: false },
      summary: `Resumed rule ${rule.name}.`,
    }
  },
  formatHint: 'json',
})
