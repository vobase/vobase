/**
 * Module-level state for channel-web. Set during init, consumed by handlers/services.
 */
import type { ContactsPort } from '@server/contracts/contacts-port'
import type { InboxPort } from '@server/contracts/inbox-port'
import type { RealtimeService } from '@server/contracts/plugin-context'

/** Minimal pg-boss shape needed for enqueuing wake jobs. */
export interface JobQueue {
  send(name: string, data: unknown): Promise<string>
}

let _inbox: InboxPort | null = null
let _contacts: ContactsPort | null = null
let _jobs: JobQueue | null = null
let _realtime: RealtimeService | null = null

export function setInboxPort(p: InboxPort): void {
  _inbox = p
}
export function setContactsPort(p: ContactsPort): void {
  _contacts = p
}
export function setJobQueue(q: JobQueue): void {
  _jobs = q
}
export function setRealtime(r: RealtimeService): void {
  _realtime = r
}

export function requireInbox(): InboxPort {
  if (!_inbox) throw new Error('channel-web: inboxPort not initialised — call setInboxPort() in module init')
  return _inbox
}
export function requireContacts(): ContactsPort {
  if (!_contacts) throw new Error('channel-web: contactsPort not initialised')
  return _contacts
}
export function requireJobs(): JobQueue {
  if (!_jobs) throw new Error('channel-web: jobQueue not initialised')
  return _jobs
}
export function requireRealtime(): RealtimeService {
  if (!_realtime) throw new Error('channel-web: realtime not initialised')
  return _realtime
}
