/**
 * Module-level state for channel-web. Built during init, consumed by handlers/services.
 */

import type { ContactsService } from '@modules/contacts/service/contacts'
import type { Auth } from '@server/auth'
import type { InboxPort } from '@server/contracts/inbox-port'
import type { RealtimeService } from '@server/contracts/plugin-context'

/** Minimal pg-boss shape needed for enqueuing wake jobs. */
export interface JobQueue {
  send(name: string, data: unknown): Promise<string>
}

interface ChannelWebStateDeps {
  inbox?: InboxPort | null
  contacts?: ContactsService | null
  jobs?: JobQueue | null
  realtime?: RealtimeService | null
  auth?: Auth | null
}

export interface ChannelWebState {
  inbox: InboxPort | null
  contacts: ContactsService | null
  jobs: JobQueue | null
  realtime: RealtimeService | null
  auth: Auth | null
}

export function createChannelWebState(deps: ChannelWebStateDeps = {}): ChannelWebState {
  return {
    inbox: deps.inbox ?? null,
    contacts: deps.contacts ?? null,
    jobs: deps.jobs ?? null,
    realtime: deps.realtime ?? null,
    auth: deps.auth ?? null,
  }
}

let _currentChannelWebState: ChannelWebState | null = null

export function installChannelWebState(state: ChannelWebState): void {
  _currentChannelWebState = state
}

export function __resetChannelWebStateForTests(): void {
  _currentChannelWebState = null
}

function current(): ChannelWebState {
  if (!_currentChannelWebState) {
    throw new Error('channel-web: state not installed — call installChannelWebState() in module init')
  }
  return _currentChannelWebState
}

export function requireInbox(): InboxPort {
  const s = current()
  if (!s.inbox) throw new Error('channel-web: inboxPort not initialised')
  return s.inbox
}
export function requireContacts(): ContactsService {
  const s = current()
  if (!s.contacts) throw new Error('channel-web: contactsPort not initialised')
  return s.contacts
}
export function requireJobs(): JobQueue {
  const s = current()
  if (!s.jobs) throw new Error('channel-web: jobQueue not initialised')
  return s.jobs
}
export function requireRealtime(): RealtimeService {
  const s = current()
  if (!s.realtime) throw new Error('channel-web: realtime not initialised')
  return s.realtime
}
/** Returns the better-auth instance if wired, null otherwise (tests that don't install it). */
export function getAuth(): Auth | null {
  return _currentChannelWebState?.auth ?? null
}

/**
 * Patch the already-installed state with the better-auth handle. Called from
 * `server/app.ts` after `createAuth(db)` — the module's own `init()` ran
 * earlier in boot order and had no auth access.
 */
export function installChannelWebAuth(auth: Auth): void {
  if (!_currentChannelWebState) {
    throw new Error('channel-web: installChannelWebAuth must be called after installChannelWebState')
  }
  _currentChannelWebState.auth = auth
}
