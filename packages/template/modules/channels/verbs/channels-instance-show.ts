import { getInstance } from '@modules/channels/service/instances'
import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

export const channelsInstanceShowVerb = defineCliVerb({
  name: 'channels instance show',
  description: 'Show details for a specific channel instance.',
  usage: 'vobase channels instance show --instanceId=<id>',
  audience: 'staff',
  input: z.object({
    instanceId: z.string(),
  }),
  body: async ({ input, ctx }) => {
    const row = await getInstance(input.instanceId)
    if (!row || row.organizationId !== ctx.organizationId) {
      return { ok: false as const, error: 'instance not found', errorCode: 'not_found' }
    }
    return {
      ok: true as const,
      data: {
        id: row.id,
        channel: row.channel,
        displayName: row.displayName,
        mode: (row.config.mode as string | undefined) ?? 'self',
        status: row.status,
        setupStage: row.setupStage,
        lastError: row.lastError,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
      summary: `${row.displayName ?? row.id} (${row.channel})`,
    }
  },
  formatHint: 'json',
})
