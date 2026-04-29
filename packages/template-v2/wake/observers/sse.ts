/**
 * createSseListener — returns a listener that calls `realtime.notify()` on
 * every event so staff messaging UIs live-tail via core's SSE endpoint.
 *
 * Factory-DI: `realtime` is passed at wake setup time, not pulled from a
 * process-wide singleton.
 */

import type { RealtimeService } from '~/runtime'
import type { AgentEvent } from '../events'

export interface SseListenerOpts {
  realtime: RealtimeService
}

export function createSseListener(opts: SseListenerOpts): (event: AgentEvent) => void {
  const { realtime } = opts
  return (event: AgentEvent): void => {
    realtime.notify({
      table: 'agent-sessions',
      id: event.conversationId,
      action: event.type,
    })
  }
}
