/**
 * Synthetic-id helpers for operator wakes.
 *
 * Operator wakes don't have a real `conversations` row — the harness still
 * needs a `conversationId: string` to satisfy `BaseEvent.conversationId`, so
 * we synthesize one keyed off the wake target:
 *
 *   - `operator-<threadId>` for `operator_thread` triggers
 *   - `heartbeat-<scheduleId>` for `heartbeat` triggers
 */

/**
 * Build the synthetic conversation id used inside an operator wake. Throws
 * if the required id for the trigger kind is missing — operator wakes are
 * always keyed off either a thread or a schedule.
 */
export function operatorConversationId(
  input: { triggerKind: 'operator_thread'; threadId: string } | { triggerKind: 'heartbeat'; scheduleId: string },
): string {
  if (input.triggerKind === 'operator_thread') {
    return `operator-${input.threadId}`
  }
  return `heartbeat-${input.scheduleId}`
}

/** Inverse of `operatorConversationId` for `operator_thread` wakes. */
export function parseOperatorThreadConversationId(conversationId: string): string | null {
  return conversationId.startsWith('operator-') ? conversationId.slice('operator-'.length) : null
}

/** Inverse of `operatorConversationId` for `heartbeat` wakes. */
export function parseHeartbeatConversationId(conversationId: string): string | null {
  return conversationId.startsWith('heartbeat-') ? conversationId.slice('heartbeat-'.length) : null
}
