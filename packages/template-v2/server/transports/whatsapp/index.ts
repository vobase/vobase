/**
 * Channel-whatsapp transport factory.
 *
 * Plain infrastructure — not a `ModuleDef`. Called from `server/app.ts` AFTER
 * all domain modules have finished `init(ctx)`. Meta authenticates inbound
 * webhooks with `X-Hub-Signature-256`, not session cookies, so there's no
 * session middleware wiring here.
 */
import type { RealtimeService, ScopedScheduler } from '@server/common/port-types'
import type { Hono } from 'hono'

import handlers from './handlers'
import { createChannelWhatsappState, installChannelWhatsappState, type JobQueue } from './service/state'

export interface ChannelWhatsappTransportDeps {
  jobs: ScopedScheduler
  realtime: RealtimeService
}

export interface ChannelWhatsappTransport {
  name: string
  handlers: Hono
}

export function createChannelWhatsappTransport(deps: ChannelWhatsappTransportDeps): ChannelWhatsappTransport {
  installChannelWhatsappState(
    createChannelWhatsappState({
      jobs: deps.jobs as unknown as JobQueue,
      realtime: deps.realtime,
    }),
  )
  console.log('[transport] channel-whatsapp initialized')
  return { name: 'channel-whatsapp', handlers }
}
