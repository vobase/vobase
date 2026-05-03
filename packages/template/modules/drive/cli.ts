/**
 * `vobase drive {ls,cat,write,rm}` verb registrations.
 *
 * Drive is partitioned by `(scope, scopeId)`; CLI input takes both as explicit
 * fields so verbs are scope-explicit (the agent harness's bash sandbox derives
 * scope from the cwd, but the CLI surface is uniform across transports).
 *
 * `upload` is deferred — `filesService.ingestUpload` is a Phase 2 stub; the
 * verb will land alongside a multipart-upload route in slice 2d.
 */

import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

import { filesServiceFor } from './service/files'
import type { DriveScope } from './service/types'
import { driveReextractVerb } from './verbs/drive-reextract'
import { driveSearchVerb } from './verbs/drive-search'
import { driveUploadVerb } from './verbs/drive-upload'

const ScopeSchema = z
  .object({
    scope: z.enum(['organization', 'contact', 'staff', 'agent']).default('organization'),
    scopeId: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.scope !== 'organization' && !val.scopeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `--scopeId is required for scope=${val.scope}`,
        path: ['scopeId'],
      })
    }
  })

function toDriveScope(input: z.infer<typeof ScopeSchema>): DriveScope {
  if (input.scope === 'organization') return { scope: 'organization' }
  if (input.scope === 'contact') return { scope: 'contact', contactId: input.scopeId as string }
  if (input.scope === 'staff') return { scope: 'staff', userId: input.scopeId as string }
  return { scope: 'agent', agentId: input.scopeId as string }
}

export const driveLsVerb = defineCliVerb({
  name: 'drive ls',
  description: 'List files at the root (or a folder) of a drive scope.',
  audience: 'admin',
  input: z.object({
    scope: z.enum(['organization', 'contact', 'staff', 'agent']).default('organization'),
    scopeId: z.string().optional(),
    parentId: z.string().nullable().optional(),
  }),
  body: async ({ input, ctx }) => {
    const scope = toDriveScope(ScopeSchema.parse({ scope: input.scope, scopeId: input.scopeId }))
    const svc = filesServiceFor(ctx.organizationId)
    const rows = await svc.listFolder(scope, input.parentId ?? null)
    return {
      ok: true as const,
      data: rows.map((f) => ({
        id: f.id,
        kind: f.kind,
        name: f.name,
        path: f.path,
        sizeBytes: f.sizeBytes,
        mimeType: f.mimeType,
        updatedAt: f.updatedAt,
      })),
    }
  },
  formatHint: 'table:cols=kind,name,path,sizeBytes,updatedAt',
})

export const driveCatVerb = defineCliVerb({
  name: 'drive cat',
  description: 'Read the contents of a drive file by path.',
  audience: 'admin',
  input: z.object({
    scope: z.enum(['organization', 'contact', 'staff', 'agent']).default('organization'),
    scopeId: z.string().optional(),
    path: z.string().min(1),
  }),
  body: async ({ input, ctx }) => {
    const scope = toDriveScope(ScopeSchema.parse({ scope: input.scope, scopeId: input.scopeId }))
    const svc = filesServiceFor(ctx.organizationId)
    const result = await svc.readPath(scope, input.path)
    if (!result) {
      return { ok: false as const, error: `path not found: ${input.path}`, errorCode: 'not_found' }
    }
    return {
      ok: true as const,
      data: {
        path: input.path,
        virtual: result.virtual,
        content: result.content,
      },
    }
  },
  formatHint: 'lines:field=content',
})

export const driveWriteVerb = defineCliVerb({
  name: 'drive write',
  description: 'Create or update a drive markdown file at the given path.',
  audience: 'admin',
  input: z.object({
    scope: z.enum(['organization', 'contact', 'staff', 'agent']).default('organization'),
    scopeId: z.string().optional(),
    path: z.string().min(1),
    content: z.string(),
  }),
  body: async ({ input, ctx }) => {
    const scope = toDriveScope(ScopeSchema.parse({ scope: input.scope, scopeId: input.scopeId }))
    const svc = filesServiceFor(ctx.organizationId)
    try {
      const file = await svc.writePath(scope, input.path, input.content)
      return { ok: true as const, data: { id: file?.id, path: file?.path, sizeBytes: input.content.length } }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        errorCode: 'write_failed',
      }
    }
  },
  formatHint: 'json',
})

export const driveRmVerb = defineCliVerb({
  name: 'drive rm',
  description: 'Remove a drive file or folder by id.',
  audience: 'admin',
  input: z.object({
    id: z.string().min(1),
  }),
  body: async ({ input, ctx }) => {
    const svc = filesServiceFor(ctx.organizationId)
    try {
      const file = await svc.get(input.id)
      if (!file) return { ok: false as const, error: `drive file not found: ${input.id}`, errorCode: 'not_found' }
      await svc.remove(input.id)
      return { ok: true as const, data: { id: input.id, path: file.path } }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        errorCode: 'remove_failed',
      }
    }
  },
  formatHint: 'json',
})

export const driveVerbs = [
  driveLsVerb,
  driveCatVerb,
  driveWriteVerb,
  driveRmVerb,
  driveUploadVerb,
  driveSearchVerb,
  driveReextractVerb,
] as const
