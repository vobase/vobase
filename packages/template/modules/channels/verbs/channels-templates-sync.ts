import { getInstance } from '@modules/channels/service/instances'
import { get as getAdapter } from '@modules/channels/service/registry'
import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

export const channelsTemplatesSyncVerb = defineCliVerb({
  name: 'channels templates sync',
  description: 'Sync message templates from Meta WABA Manager for a WhatsApp instance.',
  usage: 'vobase channels templates sync --instanceId=<id>',
  audience: 'admin',
  input: z.object({
    instanceId: z.string(),
  }),
  body: async ({ input, ctx }) => {
    const row = await getInstance(input.instanceId)
    if (!row || row.organizationId !== ctx.organizationId) {
      return { ok: false as const, error: 'instance not found', errorCode: 'not_found' }
    }
    if (row.channel !== 'whatsapp') {
      return {
        ok: false as const,
        error: 'template sync only supported for whatsapp instances',
        errorCode: 'invalid_input',
      }
    }
    const adapter = getAdapter(row.channel, row.config, input.instanceId)
    if (!adapter) {
      return { ok: false as const, error: 'adapter not registered', errorCode: 'adapter_missing' }
    }
    const syncFn = (adapter as { syncTemplates?: () => Promise<{ synced: number }> }).syncTemplates
    if (!syncFn) {
      return { ok: false as const, error: 'adapter does not support template sync', errorCode: 'not_supported' }
    }
    const result = await syncFn.call(adapter)
    return {
      ok: true as const,
      data: result,
      summary: `Synced ${result.synced} template(s)`,
    }
  },
  formatHint: 'json',
})
