/**
 * sseObserver — calls ctx.realtime.notify() on every event so the staff inbox
 * live-tails via core's SSE endpoint.
 *
 * Matches the existing useRealtimeInvalidation() hook contract from packages/template/src/hooks.
 * Spec §12.1 #2.
 */

import type { AgentEvent } from '@server/contracts/event'
import type { AgentObserver, ObserverContext } from '@server/contracts/observer'

export const sseObserver: AgentObserver = {
  id: 'agents:sse',

  handle(event: AgentEvent, ctx: ObserverContext): void {
    ctx.realtime.notify({
      table: 'agent-sessions',
      id: ctx.conversationId,
      action: event.type,
    })
  },
}
