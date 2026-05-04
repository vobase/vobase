/**
 * messaging module state transitions for conversations.
 * Only state.ts is allowed to call applyTransition (enforced by check-module-shape.ts).
 *
 * Model A — exactly one row per (organization, contact, channelInstance). No terminal
 * states; every status can cycle back via one of the listed edges.
 */

import { applyTransition, type TransitionTable } from '~/runtime'
import type { ConversationStatus } from './schema'

// ─── Message delivery status FSM ────────────────────────────────────────────

export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed'

/** Ordered status progression; backward moves are forbidden. */
const MESSAGE_STATUS_ORDER: MessageStatus[] = ['queued', 'sent', 'delivered', 'read']

/** Terminal statuses that accept no further transitions. */
export const MESSAGE_STATUS_TERMINAL: ReadonlySet<MessageStatus> = new Set(['failed'])

export function advanceMessageStatus(current: MessageStatus, next: MessageStatus): MessageStatus {
  if (MESSAGE_STATUS_TERMINAL.has(current)) {
    throw new Error(`invalid_status_transition: message status "${current}" is terminal`)
  }
  if (next === 'failed') return 'failed'
  const curIdx = MESSAGE_STATUS_ORDER.indexOf(current)
  const nextIdx = MESSAGE_STATUS_ORDER.indexOf(next)
  if (nextIdx < curIdx) {
    throw new Error(`invalid_status_transition: message status cannot move backward: ${current} -> ${next}`)
  }
  return next
}

// ─── Echo metadata key constants ─────────────────────────────────────────────

export const ECHO_META_SOURCE = 'echoSource' as const
export const ECHO_META_FLAG = 'echo' as const
export const ECHO_META_DIRECTION = 'direction' as const

// ─── Window / session codes ───────────────────────────────────────────────────

export const WINDOW_SESSION_STATE_OPEN = 'open' as const
export const WINDOW_SESSION_STATE_CLOSED = 'closed' as const
export const WINDOW_DURATION_MS = 24 * 60 * 60 * 1000

// ─── Error codes ─────────────────────────────────────────────────────────────

export const ERROR_CODE_WINDOW_EXPIRED = 'window_expired' as const

export const conversationTransitions: TransitionTable<ConversationStatus> = {
  transitions: [
    // agent-driven
    { from: 'active', to: 'resolving', event: 'agent_resolve' },
    { from: 'active', to: 'awaiting_approval', event: 'approval_requested' },
    { from: 'active', to: 'failed', event: 'agent_error' },
    // staff-driven
    { from: 'active', to: 'resolved', event: 'staff_resolve' },
    // resolving
    { from: 'resolving', to: 'resolved', event: 'confirm_resolve' },
    { from: 'resolving', to: 'active', event: 'reopen' },
    // awaiting_approval
    { from: 'awaiting_approval', to: 'active', event: 'approval_completed' },
    { from: 'awaiting_approval', to: 'failed', event: 'approval_expired' },
    // resolved
    { from: 'resolved', to: 'active', event: 'new_inbound' },
    { from: 'resolved', to: 'active', event: 'staff_reopen' },
    // failed (manual recovery only)
    { from: 'failed', to: 'active', event: 'staff_reset' },
  ],
  terminal: [],
}

export function transitionConversation(current: ConversationStatus, next: ConversationStatus): ConversationStatus {
  return applyTransition(conversationTransitions, current, next, 'messaging.conversations')
}
