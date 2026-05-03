/**
 * `vobase drive upload` — staff/admin CLI upload entry point.
 *
 * Reads bytes from a local path (the bash sandbox + binary CLI both surface
 * the host filesystem), derives a mime type from the extension via
 * `lib/lookup-mime`, then calls `filesService.ingestUpload`.
 *
 * `audience: 'staff'` per plan Step 7 — agents shouldn't bulk-upload from CLI;
 * this verb is the staff escape-hatch and admin operator surface. Customer-tier
 * wakes don't see it (`isVerbVisible` filter).
 */

import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

import { lookupMime } from '../lib/lookup-mime'
import { filesServiceFor } from '../service/files'
import type { DriveScope } from '../service/types'

const ScopeEnum = z.enum(['organization', 'contact', 'staff', 'agent']).default('organization')

function toDriveScope(input: { scope: z.infer<typeof ScopeEnum>; scopeId?: string }): DriveScope {
  if (input.scope === 'organization') return { scope: 'organization' }
  if (input.scope === 'contact') return { scope: 'contact', contactId: input.scopeId as string }
  if (input.scope === 'staff') return { scope: 'staff', userId: input.scopeId as string }
  return { scope: 'agent', agentId: input.scopeId as string }
}

export const driveUploadVerb = defineCliVerb({
  name: 'drive upload',
  description: 'Upload a local file into the drive at the given basePath.',
  audience: 'staff',
  usage:
    'vobase drive upload --path=/path/to/file.pdf [--scope=organization|contact|staff|agent] [--scopeId=<id>] [--basePath=/]',
  input: z
    .object({
      path: z.string().min(1),
      scope: ScopeEnum,
      scopeId: z.string().optional(),
      basePath: z.string().default('/'),
    })
    .superRefine((val, ctx) => {
      if (val.scope !== 'organization' && !val.scopeId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `--scopeId is required for scope=${val.scope}`,
          path: ['scopeId'],
        })
      }
    }),
  body: async ({ input, ctx }) => {
    const file = Bun.file(input.path)
    const exists = await file.exists()
    if (!exists) {
      return { ok: false as const, error: `file not found: ${input.path}`, errorCode: 'not_found' }
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    const originalName = input.path.split('/').pop() ?? input.path
    const mimeType = lookupMime(originalName)
    const scope = toDriveScope({ scope: input.scope, scopeId: input.scopeId })
    const svc = filesServiceFor(ctx.organizationId)
    try {
      const result = await svc.ingestUpload({
        organizationId: ctx.organizationId,
        scope,
        originalName,
        mimeType,
        sizeBytes: bytes.length,
        bytes,
        source: ctx.principal.kind === 'agent' ? 'agent_uploaded' : 'staff_uploaded',
        uploadedBy: ctx.principal.kind === 'agent' ? `agent:${ctx.principal.id}` : ctx.principal.id,
        basePath: input.basePath,
      })
      return {
        ok: true as const,
        data: {
          id: result.id,
          path: result.path,
          nameStem: result.nameStem,
          extractionKind: result.extractionKind,
          mimeType,
          sizeBytes: bytes.length,
        },
        summary: `Uploaded ${originalName} → ${result.path} (${result.extractionKind})`,
      }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        errorCode: 'upload_failed',
      }
    }
  },
  formatHint: 'json',
})
