/**
 * `vobase drive propose` — propose a change to an organization-drive
 * document. Goes through the changes module's proposal queue (staff review
 * required); the agent never writes `/drive/` directly.
 *
 * Migrated from the agent-bash `CommandDef`. Now also available to humans
 * over the binary so a staff member can queue a proposal from a script.
 */

import type { ChangedByKind } from '@modules/changes/schema'
import { insertProposal } from '@modules/changes/service/proposals'
import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

import { DRIVE_DOC_RESOURCE } from '../service/changes'

function principalToChangedByKind(kind: 'user' | 'agent' | 'apikey'): ChangedByKind {
  // apikey principals are typically humans / CI — record as 'user' until ChangedByKind grows.
  return kind === 'agent' ? 'agent' : 'user'
}

export const drivePropose = defineCliVerb({
  name: 'drive propose',
  description: 'Propose a change to an organization-drive document (requires staff approval).',
  usage:
    'vobase drive propose --path=/<path> --body="..." [--rationale="..."] [--expectedOutcome="..."] [--confidence=0.7]',
  audience: 'contact',
  prompt:
    'Use to fix typos, expand outdated guidance, or suggest new policy text in `/drive/`. Staff reviews; nothing changes until they accept. Do NOT write to `/drive/` directly — the FS is read-only there. `--rationale` and `--expectedOutcome` help staff decide quickly.',
  input: z.object({
    path: z.string().min(1).regex(/^\//u, '--path must be scope-relative (start with /)'),
    body: z.string().min(1),
    rationale: z.string().optional(),
    expectedOutcome: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
  }),
  body: async ({ input, ctx }) => {
    const conversationId = ctx.wake?.conversationId
    const result = await insertProposal({
      organizationId: ctx.organizationId,
      resourceModule: DRIVE_DOC_RESOURCE.module,
      resourceType: DRIVE_DOC_RESOURCE.type,
      resourceId: input.path,
      payload: { kind: 'markdown_patch', mode: 'replace', field: 'content', body: input.body },
      changedBy: ctx.principal.kind === 'agent' ? `agent:${ctx.principal.id}` : ctx.principal.id,
      changedByKind: principalToChangedByKind(ctx.principal.kind),
      confidence: input.confidence,
      rationale: input.rationale,
      expectedOutcome: input.expectedOutcome,
      conversationId,
    })
    return {
      ok: true as const,
      data: { id: result.id, status: result.status },
      summary: `Proposal ${result.id} submitted (status=${result.status}). Staff will review at /api/changes/proposals/${result.id}/decide.`,
    }
  },
  formatHint: 'json',
})
