import { type Static, Type } from '@sinclair/typebox'
import { defineAgentTool } from '@vobase/core'

import { markDismissed } from '../service/learning-candidates'

export const DismissCandidateInputSchema = Type.Object({
  candidateId: Type.String({ minLength: 1, description: 'learning_candidates.id to dismiss.' }),
  reason: Type.String({ minLength: 1, description: 'Why this candidate is not worth committing — kept for audit.' }),
})
export type DismissCandidateInput = Static<typeof DismissCandidateInputSchema>

export const dismissCandidateTool = defineAgentTool({
  name: 'dismiss_candidate',
  description:
    'Mark a pending learning candidate as dismissed (skip without committing). Audit-only; the row stays in the table for analytics.',
  schema: DismissCandidateInputSchema,
  errorCode: 'DISMISS_CANDIDATE_ERROR',
  lane: 'both',
  prompt:
    'Use when a surfaced learning candidate is noise (dup of existing memory, customer trivia, off-topic). Always supply a short `reason` so the audit trail is useful. Ignoring is also fine — uncommitted candidates expire after 7 days.',
  async run(args, _ctx) {
    await markDismissed(args.candidateId, args.reason)
    return { ok: true as const }
  },
})
