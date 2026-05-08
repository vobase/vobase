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
  const hasRejection = pending.some((c) => c.signalKind === 'rejection')
  const lines: string[] = [
    '## Pending learning candidates',
    '',
    `You have ${pending.length} pending learning signal${pending.length === 1 ? '' : 's'} from prior wakes that staff or coexisting`,
    'channels emitted before you woke. Each one represents a moment when a human corrected,',
    'coached, or echoed something the agent should learn from.',
    '',
    'For each candidate below, decide one of:',
    '  - `remember(candidateId, scope, body, confidence, rationale)` — commit a durable lesson.',
    '    Prefer this for `rejection` and `staff_takeover` signals — those are explicit corrections.',
    '  - `dismiss_candidate(candidateId, reason)` — skip when the lesson is wrong, redundant, or too narrow.',
    '',
    'A pending candidate that you act on now lives forever; a candidate ignored expires in 7 days.',
    'If the candidate is relevant to *this* customer turn, applying it behaviorally is not enough —',
    "commit it via `remember` so future wakes inherit the lesson when this conversation's history rolls off.",
  ]

  if (hasRejection) {
    lines.push('')
    lines.push('**At least one of these is a `rejection` signal — staff explicitly rejected a proposal you authored.')
    lines.push(
      'Prefer to `remember` an anti-lesson (or `dismiss_candidate` with a reason) rather than leave it pending.**',
    )
  }

  const hasSkillHint = pending.some((c) => c.scopeHint === 'agents.learned_skill')
  if (hasSkillHint) {
    lines.push('')
    lines.push(
      '**At least one candidate has scope `agents.learned_skill`. Staff has authored the steps for you — treat the candidate body as authoritative; you do NOT need to verify the steps against /drive or memory before capturing. Call `remember` with `scope=agents.learned_skill` and copy the candidate body verbatim into the skill content. High-sensitivity skill proposals route to staff review automatically (they cannot land without approval), so capturing is safe — dismissal requires an explicit reason such as "duplicates existing skill X" or "directly contradicted by /drive/Y.md". Replying to the customer without acting on the candidate is wrong.**',
    )
  }

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
