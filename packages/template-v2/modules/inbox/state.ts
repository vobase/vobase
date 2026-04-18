/**
 * inbox module state transitions for conversations.
 * Only state.ts is allowed to call applyTransition (enforced by check-module-shape.ts).
 */

import type { ConversationStatus } from '@server/contracts/domain-types'
import { applyTransition, type TransitionTable } from '@server/runtime/apply-transition'

export const conversationTransitions: TransitionTable<ConversationStatus> = {
  transitions: [
    { from: 'active', to: 'resolving', event: 'agent_resolve' },
    { from: 'active', to: 'awaiting_approval', event: 'approval_requested' },
    { from: 'active', to: 'failed', event: 'agent_error' },
    { from: 'resolving', to: 'resolved', event: 'confirm_resolve' },
    { from: 'resolving', to: 'active', event: 'reopen' },
    { from: 'awaiting_approval', to: 'active', event: 'approval_completed' },
    { from: 'awaiting_approval', to: 'failed', event: 'approval_expired' },
    { from: 'resolved', to: 'active', event: 'reopen' },
    { from: 'active', to: 'archived', event: 'archive' },
    { from: 'active', to: 'compacted', event: 'compact' },
  ],
  terminal: ['archived'],
}

export function transitionConversation(current: ConversationStatus, next: ConversationStatus): ConversationStatus {
  return applyTransition(conversationTransitions, current, next, 'inbox.conversations')
}
