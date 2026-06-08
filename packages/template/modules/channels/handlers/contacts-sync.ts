/**
 * Coexistence `smb_app_state_sync` (contacts/address-book) interception.
 *
 * Runs in the webhook POST handler after verification. When the body carries a
 * `smb_app_state_sync` change it upserts each saved contact and sets its
 * display name — this is what puts real names on imported-history contacts,
 * whose history threads carry only phone numbers — then reports "handled" so
 * the caller acks without routing it through the live inbound path.
 * `upsertByExternalKey` returns early on an existing key without touching the
 * name, so the name is set explicitly via `update`.
 */

import { parseSmbAppStateSync } from '@modules/channels/adapters/whatsapp/parse-contacts-sync'
import type { ChannelInstance } from '@modules/channels/schema'
import { update as updateContact, upsertByExternalKey } from '@modules/contacts/service/contacts'
import { normalizePhoneE164 } from '@modules/contacts/service/identity-normalize'

export async function interceptContactsSync(instance: ChannelInstance, body: unknown): Promise<boolean> {
  if (instance.channel !== 'whatsapp' && instance.channel !== 'whatsapp_notif') return false

  const root = body as { object?: string; entry?: Array<{ changes?: Array<{ field?: string }> }> }
  if (root?.object !== 'whatsapp_business_account' || !Array.isArray(root.entry)) return false
  const sawField = root.entry.some((e) => (e.changes ?? []).some((c) => c.field === 'smb_app_state_sync'))
  if (!sawField) return false

  for (const c of parseSmbAppStateSync(body)) {
    if (c.action !== 'add' || !c.fullName) continue
    const canonical = normalizePhoneE164(c.phone) || c.phone
    try {
      const contact = await upsertByExternalKey({
        organizationId: instance.organizationId,
        channel: 'whatsapp',
        externalKey: canonical,
        phone: canonical,
        displayName: c.fullName,
      })
      if (contact.displayName !== c.fullName) {
        await updateContact(contact.id, { displayName: c.fullName })
      }
    } catch (err) {
      // Drizzle wraps the driver error in a `DrizzleQueryError` whose `.message`
      // is only the "Failed query: …" SQL echo — the actual Postgres reason
      // (constraint name, SQLSTATE) lives in `.cause`. Log both so a recurrence
      // is diagnosable from the log alone.
      const cause = (err as { cause?: unknown }).cause
      console.warn(
        '[wa-contacts-sync] contact upsert failed:',
        (err as Error).message,
        cause instanceof Error ? `(cause: ${cause.message})` : cause ? `(cause: ${String(cause)})` : '',
      )
    }
  }
  return true
}
