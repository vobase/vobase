/**
 * Per-trigger spec registry.
 *
 * Each `WakeTriggerKind` is one row declaring everything that varies by wake
 * reason: which lane the wake belongs to (`conversation` vs `standalone`),
 * the log prefix, and the trigger renderer that builds the wake-reason cue
 * placed at the top of the first user-turn message.
 *
 * The lane catalogue is computed by the wake builders by filtering
 * `AgentContributions.tools` on each tool's `lane` field — adding a new
 * conversation/standalone tool is a one-line edit in its owning module's
 * `agent.ts`, not a registry change here.
 *
 * Frozen-snapshot rule: every field is a pure function of `(triggerKind,
 * trigger payload, refs)`. The renderers must be deterministic across
 * retries — no DB reads, no clock — so the `systemHash` derived downstream is
 * byte-stable.
 */

import type { WakeTrigger, WakeTriggerKind } from './events'

/**
 * Wake-context handles the renderer needs. All fields optional because
 * standalone-lane wakes (operator-thread, heartbeat) have no conversation
 * context to thread through. Each renderer reads only the fields its trigger
 * variant depends on.
 */
/**
 * Classification of a supervisor wake. Computed by the messaging module's
 * `classifySupervisorTrigger` (it owns the internal-note schema) and threaded
 * through `RenderRefs` so the renderer + tool filter can branch consistently
 * without the capability layer reaching into messaging internals.
 *
 * - `ask_staff_answer`: staff is replying to a `vobase conv ask-staff` post
 *   from THIS agent. Customer-facing tools stay available so the agent can
 *   relay the answer.
 * - `coaching`: staff-initiated feedback. Customer-facing tools are stripped
 *   so the agent treats the note as a learning event, not a reply trigger.
 */
export type SupervisorKind = 'ask_staff_answer' | 'coaching'

export interface RenderRefs {
  contactId?: string
  channelInstanceId?: string
  assignee?: string
  currentAgentId?: string
  /** Set on supervisor wakes only; ignored by other trigger renderers. */
  supervisorKind?: SupervisorKind
}

export interface TriggerSpec {
  lane: 'conversation' | 'standalone'
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
  // Assignee-wake, staff-answering-your-question branch: the messaging
  // classifier reports this is a direct reply to a `vobase conv ask-staff`
  // post the agent made. The customer-facing tool catalog stays open in
  // `wake/build-config/conversation.ts` for this kind so the agent can
  // relay the answer.
  if (refs.supervisorKind === 'ask_staff_answer') {
    return `${base} Staff is answering the question you posted in your previous internal note. If their answer gives you what you need, send the customer-facing reply now (reply / send_card / send_file / book_slot as appropriate). If you still have follow-up questions, post another \`vobase conv ask-staff\` instead of guessing. Capture any durable lesson in MEMORY.md before ending the turn.`
  }
  // Assignee-wake, coaching branch (default): customer-facing tools are
  // stripped at the harness layer (`audience: 'customer'` filter). Two
  // affordances surface here even though the playbook lives in the agent's
  // instructions, because the manual-test failure mode is silent no-op:
  //   - capture durable lessons in MEMORY.md (agent's own or contact's)
  //   - if the coaching note is ambiguous, post `vobase conv ask-staff`
  //     instead of guessing or staying silent.
  return `${base} The note is coaching/feedback from staff, NOT a request to send another customer reply — customer-facing tools are stripped on this wake. Capture any durable lesson in your MEMORY.md (or the contact's MEMORY.md if it is contact-specific). If the note is ambiguous, post a follow-up via \`vobase conv ask-staff\` rather than guessing. Follow your supervisor-coaching playbook from your instructions.`
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

const REGISTRY: Record<WakeTriggerKind, TriggerSpec> = {
  inbound_message: { lane: 'conversation', logPrefix: 'wake:conv', render: renderInboundMessage },
  approval_resumed: { lane: 'conversation', logPrefix: 'wake:conv', render: renderApprovalResumed },
  supervisor: { lane: 'conversation', logPrefix: 'wake:conv', render: renderSupervisor },
  scheduled_followup: { lane: 'conversation', logPrefix: 'wake:conv', render: renderScheduledFollowup },
  manual: { lane: 'conversation', logPrefix: 'wake:conv', render: renderManual },
  operator_thread: { lane: 'standalone', logPrefix: 'wake:solo', render: renderOperatorThread },
  heartbeat: { lane: 'standalone', logPrefix: 'wake:solo', render: renderHeartbeat },
}

export function resolveTriggerSpec(triggerKind: WakeTriggerKind): TriggerSpec {
  return REGISTRY[triggerKind]
}
