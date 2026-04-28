/**
 * Per-trigger capability registry.
 *
 * Each `WakeTriggerKind` is one row declaring everything that varies by wake
 * reason: which lane the wake belongs to (`conversation` vs `standalone`),
 * the static tool catalogue, the log prefix, and the trigger renderer that
 * builds the wake-reason cue placed at the top of the first user-turn message.
 *
 * Both wake builders pull `tools`, `logPrefix`, and `render` from the registry
 * — adding a new trigger is a registry edit, not parallel changes across two
 * builders.
 *
 * Frozen-snapshot rule: every field is a pure function of `(triggerKind,
 * trigger payload, refs)`. The renderers must be deterministic across
 * retries — no DB reads, no clock — so the `systemHash` derived downstream is
 * byte-stable.
 */

import type { AgentTool } from '@vobase/core'

import type { WakeTrigger, WakeTriggerKind } from '../events'
import { conversationTools } from '../tools/conversation'
import { standaloneTools } from '../tools/standalone'

/**
 * Wake-context handles the renderer needs. All fields optional because
 * standalone-lane wakes (operator-thread, heartbeat) have no conversation
 * context to thread through. Each renderer reads only the fields its trigger
 * variant depends on.
 */
export interface RenderRefs {
  contactId?: string
  channelInstanceId?: string
  assignee?: string
  currentAgentId?: string
}

export interface Capability {
  lane: 'conversation' | 'standalone'
  /** Static tool catalogue for this lane. */
  tools: readonly AgentTool[]
  /** Log prefix used by buildSseListener and console traces. */
  logPrefix: 'wake:conv' | 'wake:solo'
  /** Render the wake-reason cue prepended to the first user-turn message. */
  render: (trigger: WakeTrigger, refs: RenderRefs) => string
}

// ─── Renderers ─────────────────────────────────────────────────────────────

function convoFolder(refs: RenderRefs): string {
  return `/contacts/${refs.contactId}/${refs.channelInstanceId}`
}

function renderInboundMessage(_trigger: WakeTrigger, refs: RenderRefs): string {
  return `New customer message(s). See ${convoFolder(refs)}/messages.md for context.`
}

function renderApprovalResumed(trigger: WakeTrigger, _refs: RenderRefs): string {
  if (trigger.trigger !== 'approval_resumed') return ''
  return trigger.decision === 'approved'
    ? 'Your previous action was approved. Continue.'
    : `Your previous action was rejected: ${trigger.note ?? '(no note)'}. Choose a different approach.`
}

function renderSupervisor(trigger: WakeTrigger, refs: RenderRefs): string {
  if (trigger.trigger !== 'supervisor') return ''
  const base = trigger.mentionedAgentId
    ? `Staff @-mentioned you in an internal note. Read ${convoFolder(refs)}/internal-notes.md for context.`
    : `Staff added an internal note. Read ${convoFolder(refs)}/internal-notes.md for context.`
  // Peer-wake guard: if you are NOT the conversation assignee, the human or
  // agent who is must drive the customer-facing reply. Treat the staff note
  // as coaching/consultation only — internalise it (memory, learnings),
  // do not call reply / send_card / send_file / book_slot in this turn.
  const youOwn = refs.assignee === `agent:${refs.currentAgentId}`
  if (!youOwn) {
    const ownerHint = refs.assignee?.startsWith('user:')
      ? `staff member ${refs.assignee}`
      : refs.assignee?.startsWith('agent:')
        ? `another agent (${refs.assignee})`
        : `someone else (${refs.assignee ?? '(unknown)'})`
    return `${base} You are NOT the conversation assignee — ${ownerHint} owns this thread. Treat the @-mention as a peer consultation: read it, update memory if it teaches you a pattern, and end the turn. Do NOT call reply / send_card / send_file / book_slot — the assignee is in charge of customer-facing replies here.`
  }
  return base
}

function renderScheduledFollowup(trigger: WakeTrigger, _refs: RenderRefs): string {
  if (trigger.trigger !== 'scheduled_followup') return ''
  return `Scheduled follow-up: ${trigger.reason}.`
}

function renderManual(trigger: WakeTrigger, _refs: RenderRefs): string {
  if (trigger.trigger !== 'manual') return ''
  return `Manual wake: ${trigger.reason}.`
}

function renderOperatorThread(_trigger: WakeTrigger, _refs: RenderRefs): string {
  return 'A staff member posted in your operator thread. Read the latest message and respond or act.'
}

function renderHeartbeat(trigger: WakeTrigger, _refs: RenderRefs): string {
  if (trigger.trigger !== 'heartbeat') return ''
  return `Heartbeat (${trigger.reason}) at ${trigger.intendedRunAt.toISOString()}. Run your review-and-plan flow.`
}

// ─── Registry ──────────────────────────────────────────────────────────────

const REGISTRY: Record<WakeTriggerKind, Capability> = {
  inbound_message: {
    lane: 'conversation',
    tools: conversationTools,
    logPrefix: 'wake:conv',
    render: renderInboundMessage,
  },
  approval_resumed: {
    lane: 'conversation',
    tools: conversationTools,
    logPrefix: 'wake:conv',
    render: renderApprovalResumed,
  },
  supervisor: { lane: 'conversation', tools: conversationTools, logPrefix: 'wake:conv', render: renderSupervisor },
  scheduled_followup: {
    lane: 'conversation',
    tools: conversationTools,
    logPrefix: 'wake:conv',
    render: renderScheduledFollowup,
  },
  manual: { lane: 'conversation', tools: conversationTools, logPrefix: 'wake:conv', render: renderManual },
  operator_thread: {
    lane: 'standalone',
    tools: standaloneTools,
    logPrefix: 'wake:solo',
    render: renderOperatorThread,
  },
  heartbeat: { lane: 'standalone', tools: standaloneTools, logPrefix: 'wake:solo', render: renderHeartbeat },
}

export function resolveCapability(triggerKind: WakeTriggerKind): Capability {
  return REGISTRY[triggerKind]
}
