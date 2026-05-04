import { listInstances } from '@modules/channels/service/instances'
import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

export const channelsListVerb = defineCliVerb({
  name: 'channels list',
  description: 'List all channel instances for this organization.',
  usage: 'vobase channels list [--channel=<name>]',
  audience: 'staff',
  input: z.object({
    channel: z.string().optional(),
  }),
  body: async ({ input, ctx }) => {
    const rows = await listInstances(ctx.organizationId, input.channel)
    return {
      ok: true as const,
      data: rows.map((r) => ({
        id: r.id,
        channel: r.channel,
        displayName: r.displayName,
        mode: (r.config.mode as string | undefined) ?? 'self',
        status: r.status,
        setupStage: r.setupStage,
        lastError: r.lastError,
        createdAt: r.createdAt,
      })),
      summary: `${rows.length} channel instance(s)`,
    }
  },
  formatHint: 'table:cols=id,channel,displayName,mode,status,setupStage',
})
