import { detectStaffReply, type NormalizedMessage } from './normalize-message';

export interface Turn {
  id: string;
  role: 'user' | 'assistant';
  messages: NormalizedMessage[];
  senderLabel?: string;
  timestamp?: string;
}

/**
 * Derive sender label for a turn based on role and staff detection.
 * Returns 'Visitor' for user, 'Staff: Name' for staff replies, 'AI Agent' for AI.
 */
function deriveSenderLabel(
  messages: NormalizedMessage[],
  contactLabel?: string,
): string | undefined {
  if (messages.length === 0) return undefined;
  const first = messages[0];
  if (first.role === 'user') return contactLabel ?? 'Visitor';

  const staffInfo = detectStaffReply(first);
  if (staffInfo.isStaffReply) {
    return staffInfo.staffName ? `Staff: ${staffInfo.staffName}` : 'Staff';
  }
  return 'AI Agent';
}

/**
 * Group normalized messages into turns. Pure function, no side effects.
 * Consecutive messages with the same role merge into one turn.
 */
export function groupMessagesIntoTurns(
  messages: NormalizedMessage[],
  contactLabel?: string,
): Turn[] {
  if (messages.length === 0) return [];

  const turns: Turn[] = [];
  let currentTurn: Turn | null = null;

  for (const msg of messages) {
    if (!currentTurn || currentTurn.role !== msg.role) {
      if (currentTurn) turns.push(currentTurn);
      currentTurn = {
        id: msg.id,
        role: msg.role,
        messages: [msg],
        timestamp: msg.createdAt,
      };
    } else {
      currentTurn.messages.push(msg);
    }
  }

  if (currentTurn) turns.push(currentTurn);

  for (const turn of turns) {
    turn.senderLabel = deriveSenderLabel(turn.messages, contactLabel);
  }

  return turns;
}
