import type { ModuleDef } from '~/runtime'
import { buildChangeDecidedSingletonKey, CHANGES_DECIDED_TO_WAKE_JOB } from '~/wake/change-decided'
import handlers from './handlers'
import {
  type ChangeDecidedScheduler,
  createChangeProposalsService,
  installChangeProposalsService,
} from './service/proposals'

const changes: ModuleDef = {
  name: 'changes',
  // `messaging` only — `agents` is a type-only import (`AgentEvent`) and would
  // form a cycle since `agents` requires `changes` to register its materializers.
  requires: ['messaging'],
  web: { routes: { basePath: '/api/changes', handler: handlers, requireSession: true } },
  jobs: [],
  init(ctx) {
    // Bridge from `decideChangeProposal` post-commit to the pg-boss queue.
    // Singleton-keyed by (conversation, proposal, decision) so retries dedup
    // but distinct decisions never merge.
    const decidedScheduler: ChangeDecidedScheduler = {
      async enqueueChangeDecided(opts) {
        await ctx.jobs.send(CHANGES_DECIDED_TO_WAKE_JOB, opts, {
          singletonKey: buildChangeDecidedSingletonKey({
            conversationId: opts.conversationId,
            proposalId: opts.proposalId,
            decision: opts.decision,
          }),
        })
      },
    }
    installChangeProposalsService(
      createChangeProposalsService({ db: ctx.db, realtime: ctx.realtime, decidedScheduler }),
    )
  },
}

export default changes
