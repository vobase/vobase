/**
 * messaging module state transitions for conversations.
 * Only state.ts is allowed to call applyTransition (enforced by check-module-shape.ts).
 *
 * Model A — exactly one row per (organization, contact, channelInstance). No terminal
 * states; every status can cycle back via one of the listed edges.
 */

import { applyTransition, type TransitionTable } from '~/runtime'
import type { ConversationStatus } from './schema'

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
