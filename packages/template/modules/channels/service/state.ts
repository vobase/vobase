/**
 * Module-level state for the channels umbrella.
 *
 * Adapter sub-folders may install their own state in their own files
 * (e.g. `adapters/whatsapp/service/state.ts`); the umbrella owns the shared
 * jobs / realtime / auth handles that the generic dispatchers need.
 */

import type { Auth } from '@auth'
import { createRequireSession } from '@auth/middleware'
import type { RateLimiter } from '@vobase/core'
import type { MiddlewareHandler } from 'hono'

import type { RealtimeService } from '~/runtime'

export interface JobQueue {
  send(name: string, data: unknown): Promise<string>
}

interface ChannelsStateDeps {
  jobs?: JobQueue | null
  realtime?: RealtimeService | null
  auth?: Auth | null
  rateLimits?: RateLimiter | null
}

export interface ChannelsState {
  jobs: JobQueue | null
  realtime: RealtimeService | null
  auth: Auth | null
  requireSession: MiddlewareHandler | null
  rateLimits: RateLimiter | null
}

export function createChannelsState(deps: ChannelsStateDeps = {}): ChannelsState {
  return {
    jobs: deps.jobs ?? null,
    realtime: deps.realtime ?? null,
    auth: deps.auth ?? null,
    requireSession: deps.auth ? createRequireSession(deps.auth) : null,
    rateLimits: deps.rateLimits ?? null,
  }
}

let _current: ChannelsState | null = null

export function installChannelsState(state: ChannelsState): void {
  _current = state
}

export function __resetChannelsStateForTests(): void {
  _current = null
}

function current(): ChannelsState {
  if (!_current) throw new Error('channels: state not installed — call installChannelsState() in module init')
  return _current
}

export function requireJobs(): JobQueue {
  const s = current()
  if (!s.jobs) throw new Error('channels: jobQueue not initialised')
  return s.jobs
}

export function requireRealtime(): RealtimeService {
  const s = current()
  if (!s.realtime) throw new Error('channels: realtime not initialised')
  return s.realtime
}

export function getAuth(): Auth | null {
  return _current?.auth ?? null
}

export function getRequireSession(): MiddlewareHandler | null {
  return _current?.requireSession ?? null
}

/** Lazy accessor — returns null if state isn't installed (e.g. unit tests). */
export function getJobs(): JobQueue | null {
  return _current?.jobs ?? null
}

/** Lazy accessor — returns null if state isn't installed (e.g. unit tests). */
export function getRateLimits(): RateLimiter | null {
  return _current?.rateLimits ?? null
}
