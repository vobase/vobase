/**
 * Side-load contributor that surfaces pending learning_candidates in the agent's
 * next wake prompt.
 *
 * - Origin conversation: up to `candidateSideLoadCap` candidates rendered in full.
 * - Other conversations: abbreviated 1-liner count only.
 * - Heartbeats: short-circuited (synthetic conversationId prefix `heartbeat-`).
 * - Cross-agent isolation: enforced by service layer (every query filters by `agentId`).
 */

import type { LearningCandidate } from '@modules/agents/schema'
import type { SideLoadContributor } from '@vobase/core'

import { learningThresholds } from '~/wake/learning/thresholds'
import { countPendingOtherConversations, listPendingForConversation } from './learning-candidates'

export const learningCandidatesSideLoadContributor: SideLoadContributor = async (ctx) => {
  // Heartbeat wakes use synthetic conversationId = 'heartbeat-<scheduleId>'.
  // They are scheduled background work — not the right moment to surface candidates.
  if (ctx.conversationId.startsWith('heartbeat-')) return []
  // NB: operator-thread wakes ('operator-<threadId>') do see candidates per plan §4.6:
  // full visibility for candidates whose `conversation_id` matches the operator thread,
  // abbreviated for others. The conversationId equality query handles this naturally.

  const cap = learningThresholds.candidateSideLoadCap

  const [pending, otherCount] = await Promise.all([
    listPendingForConversation(ctx.organizationId, ctx.agentId, ctx.conversationId, cap),
    countPendingOtherConversations(ctx.organizationId, ctx.agentId, ctx.conversationId),
  ])

  if (pending.length === 0 && otherCount === 0) return []

  return [
    {
      kind: 'custom',
      priority: 30,
      render: () => renderSection(pending, otherCount),
    },
  ]
}

function renderSection(pending: LearningCandidate[], otherCount: number): string {
  const lines: string[] = [
    '## Pending learning candidates',
    '',
    `You have ${pending.length} pending learning signal${pending.length === 1 ? '' : 's'} from before this wake. Use the \`remember\``,
    'tool to commit one to durable memory, or `dismiss_candidate` to skip with a',
    'reason. Ignoring them is also fine — they expire after 7 days.',
  ]

  if (pending.length > 0) {
    lines.push('')
    for (let i = 0; i < pending.length; i++) {
      const c = pending[i]
      if (!c) continue
      const conf = (c.triageConfidence * 100).toFixed(0)
      lines.push(`${i + 1}. [\`${c.id}\`] (signal: ${c.signalKind}, triage confidence ${conf}%)`)
      if (c.scopeHint) {
        lines.push(`   _Suggested scope:_ \`${c.scopeHint}\``)
      }
      lines.push(`   ${c.summary}`)
    }
  }

  if (otherCount > 0) {
    lines.push('')
    lines.push(
      `_${otherCount} more pending candidate${otherCount === 1 ? '' : 's'} from other conversations. Switch to those threads`,
    )
    lines.push('to act on them, or call `remember` with their candidateId here._')
  }

  return lines.join('\n')
}
