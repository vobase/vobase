/**
 * Channel-web transport factory.
 *
 * Plain infrastructure — not a `ModuleDef`. Called from `server/app.ts` AFTER
 * all domain modules (messaging, contacts, drive, …) have completed their
 * `init(ctx)` pass. The caller enforces ordering by line sequence; this
 * replaces the implicit `requires: ['messaging','contacts','drive']` the old
 * `module.ts` carried.
 */
import type { RealtimeService, ScopedScheduler } from '@server/common/port-types'
import type { ScopedDb } from '@server/common/scoped-db'
import type { Hono } from 'hono'
import handlers from './handlers'
import { createWebInstancesService, installWebInstancesService } from './service/instances'
import { createChannelWebState, installChannelWebState, type JobQueue } from './service/state'

export interface ChannelWebTransportDeps {
  db: ScopedDb
  jobs: ScopedScheduler
  realtime: RealtimeService
}

export interface ChannelWebTransport {
  name: string
  handlers: Hono
}

export function createChannelWebTransport(deps: ChannelWebTransportDeps): ChannelWebTransport {
  installChannelWebState(
    createChannelWebState({
      jobs: deps.jobs as unknown as JobQueue,
      realtime: deps.realtime,
    }),
  )
  installWebInstancesService(createWebInstancesService({ db: deps.db }))
  console.log('[transport] channel-web initialized')
  return { name: 'channel-web', handlers }
}
