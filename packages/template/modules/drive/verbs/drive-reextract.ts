/**
 * `vobase drive reextract` — operator recovery tool. Resets a drive file
 * to `(pending, pending)` and re-enqueues `drive:process-file`. The reaper
 * already handles stuck rows, so this verb is for explicit recovery — e.g.
 * after an embedding outage left a row at `(extracted, failed)`.
 *
 * `audience: 'admin'` per plan Step 7 — operator-only.
 */

import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

import { filesServiceFor } from '../service/files'

export const driveReextractVerb = defineCliVerb({
  name: 'drive reextract',
  description: 'Reset and re-enqueue extraction for a drive file (recovery tool).',
  audience: 'admin',
  usage: 'vobase drive reextract --id=<driveFileId>',
  input: z.object({ id: z.string().min(1) }),
  body: async ({ input, ctx }) => {
    const svc = filesServiceFor(ctx.organizationId)
    try {
      const row = await svc.get(input.id)
      if (!row) {
        return { ok: false as const, error: `drive file not found: ${input.id}`, errorCode: 'not_found' }
      }
      await svc.reextract(input.id)
      return {
        ok: true as const,
        data: { id: input.id, path: row.path },
        summary: `Re-enqueued extraction for ${row.path}`,
      }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        errorCode: 'reextract_failed',
      }
    }
  },
  formatHint: 'json',
})
