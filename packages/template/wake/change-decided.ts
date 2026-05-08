/**
 * change_decided wake handler — processes `changes:decided-to-wake` jobs
 * fired by `decideChangeProposal` post-commit.
 *
 * Both approval and rejection enqueue this job (when the proposal carries a
 * real customer `conversationId`). The wake fires conversation-bound on the
 * conversation's current agent assignee — same lane the original change was
 * proposed in. The renderer cue (`wake/trigger.ts::renderChangeDecided`)
 * tells the agent to send a polite acknowledgment to the customer.
 *
 * Synthetic standalone-lane conversation ids (`operator-...`, `heartbeat-...`)
 * are filtered upstream — only real conversations enqueue this job.
 */

import type { AgentDefinition } from '@modules/agents/schema'
import { getById as getAgentDefinition } from '@modules/agents/service/agent-definitions'
import type { Conversation } from '@modules/messaging/schema'
import { get as getConversation } from '@modules/messaging/service/conversations'
import type { AgentContributions, HarnessLogger, ScopedScheduler } from '@vobase/core'
import { createHarness } from '@vobase/core'
import { z } from 'zod'

import type { RealtimeService, ScopedDb } from '~/runtime'
import type { WakeContext } from './context'
import { conversationWakeConfig } from './conversation'
import type { WakeTrigger } from './events'

export const CHANGES_DECIDED_TO_WAKE_JOB = 'changes:decided-to-wake'

export const ChangeDecidedWakePayloadSchema = z.object({
  organizationId: z.string(),
  conversationId: z.string(),
  proposalId: z.string(),
  decision: z.enum(['approved', 'rejected']),
  resourceModule: z.string(),
  resourceType: z.string(),
  resourceId: z.string(),
  summary: z.string().nullable(),
  decidedNote: z.string().nullable(),
  decidedBy: z.string(),
})

export type ChangeDecidedWakePayload = z.infer<typeof ChangeDecidedWakePayloadSchema>

export interface ChangeDecidedWakeDeps {
  realtime: RealtimeService
  db: ScopedDb
  logger: HarnessLogger
  jobs: ScopedScheduler
}

/**
 * Job-name constant for pg-boss singleton keying. Each `(conversation,
 * proposal, decision)` tuple has a unique key so retries dedup but distinct
 * decisions never merge.
 */
export function buildChangeDecidedSingletonKey(opts: {
  conversationId: string
  proposalId: string
  decision: 'approved' | 'rejected'
}): string {
  return `${opts.conversationId}:${opts.proposalId}:${opts.decision}`
}

export function createChangeDecidedWakeHandler(
  deps: ChangeDecidedWakeDeps,
  contributions: AgentContributions<WakeContext>,
) {
  return async function handleChangeDecidedWake(rawData: unknown): Promise<void> {
    const data = rawData as ChangeDecidedWakePayload
    console.log('[wake:conv] handling change_decided→wake', {
      conv: data.conversationId,
      proposal: data.proposalId,
      decision: data.decision,
    })

    let conv: Conversation
    try {
      conv = await getConversation(data.conversationId)
    } catch (err) {
      console.error('[wake:conv] conversation lookup failed for change_decided:', err)
      return
    }

    const fallbackAssigneeAgentId = conv.assignee.startsWith('agent:') ? conv.assignee.slice('agent:'.length) : null
    if (!fallbackAssigneeAgentId) {
      console.log('[wake:conv] skipping change_decided — conversation has no agent assignee', {
        conv: data.conversationId,
        assignee: conv.assignee,
      })
      return
    }

    let agentDefinition: AgentDefinition
    try {
      agentDefinition = await getAgentDefinition(fallbackAssigneeAgentId)
    } catch (err) {
      console.log('[wake:conv] skipping change_decided — agent_definitions row missing', {
        agentId: fallbackAssigneeAgentId,
        err,
      })
      return
    }

    const triggerOverride: WakeTrigger = {
      trigger: 'change_decided',
      conversationId: data.conversationId,
      proposalId: data.proposalId,
      decision: data.decision,
      resourceModule: data.resourceModule,
      resourceType: data.resourceType,
      resourceId: data.resourceId,
      summary: data.summary,
      decidedNote: data.decidedNote,
      decidedBy: data.decidedBy,
    }

    try {
      const config = await conversationWakeConfig({
        data: {
          organizationId: data.organizationId,
          conversationId: data.conversationId,
          // No inbound message — sentinel mirrors staff-note wake's pattern.
          messageId: '',
          contactId: conv.contactId,
        },
        conv,
        agentId: fallbackAssigneeAgentId,
        agentDefinition,
        contributions,
        deps,
        triggerOverride,
      })
      await createHarness<WakeTrigger>(config)
    } catch (err) {
      console.error('[wake:conv] createHarness (change_decided) failed:', err)
    }
  }
}
