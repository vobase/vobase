import type { AgentsPort } from '@server/contracts/agents-port'
import type { WakeRefusedEvent } from '@server/contracts/event'
import type { InboxPort } from '@server/contracts/inbox-port'
import type { EventBus } from '@server/contracts/plugin-context'

export interface DailyCeilingNackInput {
  tenantId: string
  agentId: string
  conversationId: string
  wakeId: string
  events: EventBus
  agentsPort: AgentsPort
  inboxPort: InboxPort
}

/**
 * Checks whether this tenant's daily cost ceiling is exceeded.
 * If so: emits `WakeRefusedEvent` and sends an apology text message.
 *
 * Returns true when the wake was refused — callers must NOT proceed to `bootWake`.
 * The inbound message row is kept in the database regardless (do NOT swallow the inbound).
 */
export async function checkAndNackDailyCeiling(input: DailyCeilingNackInput): Promise<boolean> {
  const { exceeded } = await input.agentsPort.checkDailyCeiling(input.tenantId, input.agentId)
  if (!exceeded) return false

  const refusedEvt: WakeRefusedEvent = {
    ts: new Date(),
    wakeId: input.wakeId,
    conversationId: input.conversationId,
    tenantId: input.tenantId,
    turnIndex: 0,
    type: 'wake_refused',
    reason: 'daily_ceiling',
  }
  input.events.publish(refusedEvt)

  await input.inboxPort
    .sendTextMessage({
      conversationId: input.conversationId,
      tenantId: input.tenantId,
      author: { kind: 'agent', id: input.agentId },
      body: "We're temporarily over capacity; please try again shortly.",
    })
    .catch(() => undefined)

  return true
}
