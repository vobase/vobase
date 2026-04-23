/**
 * sseListener — calls realtime.notify() on every event so the staff messaging
 * live-tails via core's SSE endpoint.
 *
 * Plain `OnEventListener` — closes over the `getRealtime()` service singleton
 * and reads wake identity from the event's `HarnessBaseFields`.
 */

import type { AgentEvent } from '@server/contracts/event'
import { getRealtime } from '@server/services'

export const sseListener = (event: AgentEvent): void => {
  getRealtime().notify({
    table: 'agent-sessions',
    id: event.conversationId,
    action: event.type,
  })
}
