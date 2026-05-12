/**
 * `vobase drive upload` — staff/admin CLI upload entry point.
 *
 * The CLI binary (`packages/cli`) reads the operator's local file client-side
 * via `resolveFileFrom` and submits its bytes as `fileBytes` (base64) +
 * `filename` (basename). Server-side this verb decodes the base64 and hands
 * the bytes to `filesService.ingestUpload`. Older paths that did
 * `Bun.file(input.path)` on the server were broken for remote tenants — the
 * server would look for the operator's path on its own filesystem.
 *
 * The agent-bash in-process transport doesn't hit the resolver, so agents
 * that want to upload a workspace-local file have to base64 it themselves
 * before calling the verb (rare path; the agent's first-class upload tool
 * lives elsewhere).
 *
 * `audience: 'staff'` — agents shouldn't bulk-upload from CLI; this verb is
 * the staff escape-hatch and admin operator surface. Customer-tier wakes
 * don't see it (`isVerbVisible` filter).
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
    'vobase drive upload --file=/path/to/file.pdf [--scope=organization|contact|staff|agent] [--scopeId=<id>] [--basePath=/]',
  input: z
    .object({
      /** Base64-encoded bytes of the operator-local file. Populated client-side by `resolveFileFrom`. */
      fileBytes: z.string().min(1),
      /** Destination filename (basename of the local path; drives mime + display name). */
      filename: z.string().min(1),
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
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(Buffer.from(input.fileBytes, 'base64'))
    } catch (err) {
      return {
        ok: false as const,
        error: `invalid base64 in fileBytes: ${err instanceof Error ? err.message : String(err)}`,
        errorCode: 'invalid_input',
      }
    }
    if (bytes.length === 0) {
      return { ok: false as const, error: 'fileBytes decoded to zero bytes', errorCode: 'invalid_input' }
    }
    const originalName = input.filename.split('/').pop() ?? input.filename
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
