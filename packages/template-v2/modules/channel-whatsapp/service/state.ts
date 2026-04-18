/**
 * Module-level state for channel-whatsapp.
 */
import type { ContactsPort } from '@server/contracts/contacts-port'
import type { InboxPort } from '@server/contracts/inbox-port'
import type { RealtimeService } from '@server/contracts/plugin-context'

export interface JobQueue {
  send(name: string, data: unknown): Promise<string>
}

let _inbox: InboxPort | null = null
let _contacts: ContactsPort | null = null
let _jobs: JobQueue | null = null
let _realtime: RealtimeService | null = null

/** Phone number ID used when sending via Meta Graph API. Set from channel_instance config. */
let _phoneNumberId: string | null = null
/** Meta Graph API access token. */
let _accessToken: string | null = null
/** Webhook verify token (Meta hub challenge). */
let _verifyToken: string | null = null
/** HMAC secret for Meta webhook signature verification. */
let _webhookSecret: string | null = null

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
export function setPhoneNumberId(id: string): void {
  _phoneNumberId = id
}
export function setAccessToken(t: string): void {
  _accessToken = t
}
export function setVerifyToken(t: string): void {
  _verifyToken = t
}
export function setWebhookSecret(s: string): void {
  _webhookSecret = s
}

export function requireInbox(): InboxPort {
  if (!_inbox) throw new Error('channel-whatsapp: inboxPort not initialised')
  return _inbox
}
export function requireContacts(): ContactsPort {
  if (!_contacts) throw new Error('channel-whatsapp: contactsPort not initialised')
  return _contacts
}
export function requireJobs(): JobQueue {
  if (!_jobs) throw new Error('channel-whatsapp: jobQueue not initialised')
  return _jobs
}
export function requireRealtime(): RealtimeService {
  if (!_realtime) throw new Error('channel-whatsapp: realtime not initialised')
  return _realtime
}
export function requirePhoneNumberId(): string {
  return _phoneNumberId ?? process.env.WA_PHONE_NUMBER_ID ?? ''
}
export function requireAccessToken(): string {
  return _accessToken ?? process.env.WA_ACCESS_TOKEN ?? ''
}
export function requireVerifyToken(): string {
  return _verifyToken ?? process.env.WA_VERIFY_TOKEN ?? 'dev-verify-token'
}
export function requireWebhookSecret(): string {
  return _webhookSecret ?? process.env.WA_WEBHOOK_SECRET ?? 'dev-webhook-secret'
}
