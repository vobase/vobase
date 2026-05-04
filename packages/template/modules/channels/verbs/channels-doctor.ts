import { runDoctor } from '@modules/channels/service/doctor'
import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

export const channelsDoctorVerb = defineCliVerb({
  name: 'channels doctor',
  description:
    'Run health checks for a channel instance (debug_token, subscribed_apps, templates, phone, connectivity).',
  usage: 'vobase channels doctor --instanceId=<id>',
  audience: 'staff',
  input: z.object({
    instanceId: z.string(),
  }),
  body: async ({ input, ctx }) => {
    const result = await runDoctor(input.instanceId, ctx.organizationId)
    return {
      ok: true as const,
      data: result,
      summary: `${result.checks.filter((c) => c.status === 'green').length}/${result.checks.length} checks green`,
    }
  },
  formatHint: 'json',
})
