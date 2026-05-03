/**
 * `vobase drive search` — hybrid pgvector + tsvector search across drive
 * chunks for the caller's organization.
 *
 * `audience: 'contact'` per plan Step 7 — read-only and tenant-scoped, so
 * even contact-tier wakes can search.
 */

import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

import { filesServiceFor } from '../service/files'
import type { DriveScope } from '../service/types'

const ScopeEnum = z.enum(['organization', 'contact', 'staff', 'agent']).optional()

function toScope(scope: z.infer<typeof ScopeEnum>, scopeId: string | undefined): DriveScope | undefined {
  if (!scope) return undefined
  if (scope === 'organization') return { scope: 'organization' }
  if (!scopeId) return undefined
  if (scope === 'contact') return { scope: 'contact', contactId: scopeId }
  if (scope === 'staff') return { scope: 'staff', userId: scopeId }
  return { scope: 'agent', agentId: scopeId }
}

export const driveSearchVerb = defineCliVerb({
  name: 'drive search',
  description: 'Hybrid search (pgvector + tsvector) across drive chunks for this organization.',
  audience: 'contact',
  usage: 'vobase drive search --query="..." [--scope=...] [--scopeId=...] [--limit=10]',
  input: z.object({
    query: z.string().min(1),
    scope: ScopeEnum,
    scopeId: z.string().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  body: async ({ input, ctx }) => {
    const svc = filesServiceFor(ctx.organizationId)
    const hits = await svc.searchDrive({
      organizationId: ctx.organizationId,
      query: input.query,
      scope: toScope(input.scope, input.scopeId),
      limit: input.limit,
    })
    return {
      ok: true as const,
      data: hits.map((h) => ({
        fileId: h.fileId,
        path: h.path,
        caption: h.caption,
        chunkIndex: h.chunkIndex,
        excerpt: h.excerpt,
        score: Number(h.score.toFixed(4)),
      })),
      summary: `${hits.length} hit${hits.length === 1 ? '' : 's'}`,
    }
  },
  formatHint: 'table:cols=path,score,excerpt',
})
