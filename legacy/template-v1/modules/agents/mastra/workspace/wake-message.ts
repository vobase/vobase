// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Wake message builder — constructs the initial message sent to the
// agent on each wake, with token-budgeted inline message injection.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type WakeTrigger = 'inbound_message' | 'scheduled_followup' | 'supervisor' | 'manual'

export interface WakeMessageEntry {
  time: string
  from: string
  content: string
}

export interface WakeMessageOptions {
  trigger: WakeTrigger
  messages: WakeMessageEntry[]
  budget?: number
  payload?: Record<string, unknown>
}

const HISTORY_HINT = 'Full conversation history is at conversation/messages.md if you need more context.'

/** Rough token estimate: ~4 chars per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** Format a single message entry as `[time] from: content`. */
function formatEntry(entry: WakeMessageEntry): string {
  return `[${entry.time}] ${entry.from}: ${entry.content}`
}

/**
 * Build the wake message sent to an agent.
 *
 * For `inbound_message`: walks backwards from newest messages, inlining
 * as many as fit within the token budget. Always includes at least the
 * most recent message even if it exceeds budget.
 *
 * For other triggers: produces a short directive with a pointer to the
 * full conversation file.
 */
export function buildWakeMessage(options: WakeMessageOptions): string {
  const { trigger, messages, budget = 500, payload } = options

  switch (trigger) {
    case 'scheduled_followup': {
      const reason = (payload?.reason as string | undefined) ?? 'Check in with contact'
      return `Scheduled follow-up: ${reason}. Read conversation/messages.md for context.`
    }
    case 'supervisor': {
      const instruction = (payload?.instruction as string | undefined) ?? 'Review conversation'
      return `Supervisor instruction: ${instruction}. Read conversation/messages.md for context.`
    }
    case 'manual': {
      const reason = (payload?.reason as string | undefined) ?? 'Agent wake requested'
      return `Manual wake: ${reason}. Read conversation/messages.md for context.`
    }
    case 'inbound_message':
      return buildInboundWakeMessage(messages, budget)
  }
}

function buildInboundWakeMessage(messages: WakeMessageEntry[], budget: number): string {
  if (messages.length === 0) {
    return `New inbound message received. Read conversation/messages.md for context.`
  }

  // Walk backwards from newest, accumulating messages within token budget
  const selected: string[] = []
  let usedTokens = 0

  // Reserve tokens for framing text
  const framingOverhead = estimateTokens(`New messages:\n\n\n${HISTORY_HINT}`)
  const availableBudget = Math.max(budget - framingOverhead, 0)

  for (let i = messages.length - 1; i >= 0; i--) {
    const formatted = formatEntry(messages[i])
    const cost = estimateTokens(formatted)

    if (selected.length === 0) {
      // Always include at least the most recent message
      selected.unshift(formatted)
      usedTokens += cost
    } else if (usedTokens + cost <= availableBudget) {
      selected.unshift(formatted)
      usedTokens += cost
    } else {
      break
    }
  }

  const omitted = messages.length - selected.length
  const parts: string[] = ['New messages:']

  if (omitted > 0) {
    parts.push(`(${omitted} earlier message(s) not shown — read conversation/messages.md for full history)`)
  }

  parts.push(selected.join('\n'))
  parts.push(HISTORY_HINT)

  return parts.join('\n\n')
}
