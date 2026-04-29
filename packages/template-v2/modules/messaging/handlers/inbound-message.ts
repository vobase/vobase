import type { WakeRefusedEvent } from '~/wake/events'
import type { AgentsPort } from '@modules/agents/service/types'

import type { MessagingPort } from '../service/types'

export interface DailyCeilingNackInput {
  organizationId: string
  agentId: string
  conversationId: string
  wakeId: string
  events: { publish(event: WakeRefusedEvent): void }
  agentsPort: AgentsPort
  messagingPort: MessagingPort
}

/**
 * Checks whether this organization's daily cost ceiling is exceeded.
 * If so: emits `WakeRefusedEvent` and sends an apology text message.
 *
 * Returns true when the wake was refused — callers must NOT proceed to `bootWake`.
 * The inbound message row is kept in the database regardless (do NOT swallow the inbound).
 */
export async function checkAndNackDailyCeiling(input: DailyCeilingNackInput): Promise<boolean> {
  const { exceeded } = await input.agentsPort.checkDailyCeiling(input.organizationId, input.agentId)
  if (!exceeded) return false

  const refusedEvt: WakeRefusedEvent = {
    ts: new Date(),
    wakeId: input.wakeId,
    conversationId: input.conversationId,
    organizationId: input.organizationId,
    turnIndex: 0,
    type: 'wake_refused',
    reason: 'daily_ceiling',
  }
  input.events.publish(refusedEvt)

  await input.messagingPort
    .sendTextMessage({
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      author: { kind: 'agent', id: input.agentId },
      body: "We're temporarily over capacity; please try again shortly.",
    })
    .catch(() => undefined)

  return true
}
