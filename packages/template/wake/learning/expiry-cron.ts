/**
 * Daily cron job that flips stale `learning_candidates` rows from `pending` to `expired`.
 *
 * Registered in `runtime/bootstrap.ts` (US-413). Defined here so it can be imported
 * by the bootstrap without pulling in the full agents module.
 */

import { sweepExpired } from '@modules/agents/service/learning-candidates'
import type { JobDef } from '@vobase/core'

import { learningThresholds } from './thresholds'

export const LEARNING_CANDIDATE_EXPIRY_JOB = 'learning:candidate-expiry'
/** Daily at 03:00 UTC — quiet hours across most tenants. */
export const LEARNING_CANDIDATE_EXPIRY_CRON = '0 3 * * *'

export const learningCandidateExpiryJob: JobDef = {
  name: LEARNING_CANDIDATE_EXPIRY_JOB,
  handler: async (_data: unknown) => {
    const swept = await sweepExpired(learningThresholds.candidateExpiryDays)
    if (swept > 0) {
      console.info(`[learning:expiry] swept ${swept} candidate(s) → expired`)
    }
  },
}
