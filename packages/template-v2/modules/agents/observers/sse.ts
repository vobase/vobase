/**
 * sseObserver — calls realtime.notify() on every event so the staff inbox
 * live-tails via core's SSE endpoint.
 *
 * Matches the existing useRealtimeInvalidation() hook contract from packages/template/src/hooks.
 */

import type { AgentEvent } from '@server/contracts/event'
import type { AgentObserver } from '@server/contracts/observer'
import { getRealtime } from '@server/services'

export const sseObserver: AgentObserver = {
  id: 'agents:sse',

  handle(event: AgentEvent): void {
    getRealtime().notify({
      table: 'agent-sessions',
      id: event.conversationId,
      action: event.type,
    })
  },
}
