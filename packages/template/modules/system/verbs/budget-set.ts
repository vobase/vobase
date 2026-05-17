/**
 * `vobase budget:set --capUsd=<dollars> | --clear`
 *
 * Sets or clears the per-tenant daily LLM cost cap. Cap input is in DOLLARS
 * for ergonomics; the service stores cents (`tenant_budget_caps.daily_cap_usd`).
 *
 * Cleared caps remove the row entirely; the dispatcher / budget-watcher treat
 * the org as uncapped (no row → no cap).
 */

import { budgetCapsService } from '@modules/automations/service/budget-caps'
import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

export const budgetSetVerb = defineCliVerb({
  name: 'budget:set',
  description: 'Set or clear the per-tenant daily LLM cost cap (dollars). Pass --clear to remove the cap.',
  audience: 'staff',
  input: z
    .object({
      capUsd: z.number().nonnegative().optional(),
      clear: z.boolean().optional(),
    })
    .refine((v) => v.clear === true || typeof v.capUsd === 'number', {
      message: 'must pass --capUsd=<dollars> or --clear',
    }),
  body: async ({ input, ctx }) => {
    if (ctx.principal.kind === 'agent') {
      return { ok: false as const, error: 'agents cannot set budget caps', errorCode: 'forbidden' }
    }
    const capCents = input.clear === true ? null : Math.round((input.capUsd ?? 0) * 100)
    await budgetCapsService.setBudget(ctx.organizationId, capCents, {
      actor: { id: ctx.principal.id, kind: 'user' },
    })
    return {
      ok: true as const,
      data: {
        organizationId: ctx.organizationId,
        capUsd: capCents === null ? null : capCents / 100,
      },
      summary: capCents === null ? 'Cleared budget cap.' : `Set budget cap to $${(capCents / 100).toFixed(2)} / day.`,
    }
  },
  formatHint: 'json',
})
