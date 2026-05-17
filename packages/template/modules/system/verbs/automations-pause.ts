/**
 * `vobase automations:pause --ruleId=<id> --reason=<string>`
 *
 * Operator-facing verb wired to `automationsService.pauseRule`. The service
 * is the sole writer of `automations.automations` rows (one-write-path,
 * `check:shape`-enforced); this verb is just the bash surface.
 *
 * Actor: `ctx.principal.id` from the resolved CLI session. Agent principals
 * cannot pause rules — pausing is a staff/operator action.
 */

import { automationsService } from '@modules/automations/service/automations'
import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

export const automationsPauseVerb = defineCliVerb({
  name: 'automations:pause',
  description: 'Pause an automation rule. Suppresses future fires until resumed; existing runs unaffected.',
  audience: 'staff',
  input: z.object({
    ruleId: z.string().min(1),
    reason: z.string().min(1),
  }),
  body: async ({ input, ctx }) => {
    if (ctx.principal.kind === 'agent') {
      return { ok: false as const, error: 'agents cannot pause rules', errorCode: 'forbidden' }
    }
    const rule = await automationsService.getRuleById(input.ruleId)
    if (!rule || rule.organizationId !== ctx.organizationId) {
      return { ok: false as const, error: `rule not found: ${input.ruleId}`, errorCode: 'not_found' }
    }
    await automationsService.pauseRule(input.ruleId, input.reason, {
      actor: { id: ctx.principal.id, kind: 'user' },
    })
    return {
      ok: true as const,
      data: { ruleId: input.ruleId, paused: true, reason: input.reason },
      summary: `Paused rule ${rule.name}.`,
    }
  },
  formatHint: 'json',
})
