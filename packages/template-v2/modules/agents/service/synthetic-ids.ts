/**
 * Synthetic-id helpers for operator wakes + workspace tree.
 *
 * Operator wakes don't have a real `conversations` row — the harness still
 * needs a `conversationId: string` to satisfy `BaseEvent.conversationId`, so
 * we synthesize one keyed off the wake target:
 *
 *   - `operator-<threadId>` for `operator_thread` triggers
 *   - `heartbeat-<scheduleId>` for `heartbeat` triggers
 *
 * Frontend (workspace tree, tab strip, layout right-rail) parses the same
 * `/workspace/chats/<threadId>` + `/workspace/schedules/<scheduleId>` URL
 * shapes. Both ends import from this module so the two sides stay in lockstep.
 */

export const OPERATOR_CHAT_PATH_PREFIX = '/workspace/chats/' as const
export const OPERATOR_SCHEDULE_PATH_PREFIX = '/workspace/schedules/' as const

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

/**
 * Frontend path helpers. The workspace tree renders these paths as nodes;
 * the layout reads the active tab's path through these same helpers so the
 * frontend can never drift from the backend's synthetic-id derivation.
 */
export function operatorChatPath(threadId: string): string {
  return `${OPERATOR_CHAT_PATH_PREFIX}${threadId}`
}

export function operatorSchedulePath(scheduleId: string): string {
  return `${OPERATOR_SCHEDULE_PATH_PREFIX}${scheduleId}`
}

export function parseOperatorChatPath(path: string): string | null {
  return path.startsWith(OPERATOR_CHAT_PATH_PREFIX) ? path.slice(OPERATOR_CHAT_PATH_PREFIX.length) : null
}

export function parseOperatorSchedulePath(path: string): string | null {
  return path.startsWith(OPERATOR_SCHEDULE_PATH_PREFIX) ? path.slice(OPERATOR_SCHEDULE_PATH_PREFIX.length) : null
}
