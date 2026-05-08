/**
 * Self-reflection enqueue helper — conversation-lane wakes call this on
 * `agent_end` to submit a triage signal for the learning pipeline.
 *
 * Kept in its own file so the unit test can import it without pulling in the
 * full `conversation.ts` dependency graph (which includes workspace setup and
 * other heavy modules that require DB state).
 *
 * The job name is inlined here (mirrors `LEARNING_TRIAGE_JOB` in
 * `wake/learning/triage-job.ts`) so this module stays free of the
 * `modules/agents/schema` import chain that `triage-job.ts` carries.
 */

import type { ScopedScheduler } from '@vobase/core'

/** Mirrors `LEARNING_TRIAGE_JOB` from `wake/learning/triage-job.ts`. */
const LEARNING_TRIAGE_JOB = 'learning:triage'

export interface SelfReflectionCtx {
  jobs: ScopedScheduler
  organizationId: string
  agentId: string
  conversationId: string
}

/**
 * Body text for the self-reflection signal. Triage prompts treat
 * `signalBody` as "the given learning signal"; an empty body looks
 * indistinguishable from a no-op trigger and reliably drops as low
 * signal. Point the cheap-model triage at the journal context instead
 * — that is where the actual wake activity lives.
 */
const SELF_REFLECTION_BODY =
  'Wake just ended. Review the journal context below for non-trivial patterns worth remembering: ' +
  'recurring customer topics, mistakes the agent made, durable handling rules, or anti-lessons. ' +
  'Skip when the wake was a routine no-op (greeting, FAQ already covered).'

export async function enqueueSelfReflection(ctx: SelfReflectionCtx, event: { wakeId: string }): Promise<void> {
  try {
    await ctx.jobs.send(LEARNING_TRIAGE_JOB, {
      organizationId: ctx.organizationId,
      agentId: ctx.agentId,
      conversationId: ctx.conversationId,
      signal: { kind: 'self_reflection', wakeId: event.wakeId, body: SELF_REFLECTION_BODY },
    })
  } catch (err) {
    console.warn('[wake/conversation] self_reflection triage enqueue failed:', err)
  }
}
