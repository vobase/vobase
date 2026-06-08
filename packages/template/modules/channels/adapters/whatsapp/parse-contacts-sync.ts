/**
 * Pure parser for the coexistence `smb_app_state_sync` webhook — the business's
 * WhatsApp address book (one-way: Business App → Cloud API). Each `state_sync`
 * entry of `type: 'contact'` carries the saved `full_name` + phone, which is
 * how we put real names on imported-history contacts (history threads carry
 * only phone numbers). No I/O — factored for later contribution to
 * `@vobase/core`.
 */

export interface ParsedContactSync {
  /** Raw WhatsApp phone number (no `+`). */
  phone: string
  /** The business's saved name for this contact, if any. */
  fullName: string | null
  action: 'add' | 'remove'
}

interface RawStateSyncItem {
  type?: string
  action?: string
  contact?: { full_name?: string; first_name?: string; phone_number?: string }
}
interface RawValue {
  state_sync?: RawStateSyncItem[]
}
interface RawBody {
  object?: string
  entry?: Array<{ changes?: Array<{ field?: string; value?: RawValue }> }>
}

export function parseSmbAppStateSync(payload: unknown): ParsedContactSync[] {
  const root = payload as RawBody
  if (root?.object !== 'whatsapp_business_account' || !Array.isArray(root.entry)) return []

  const out: ParsedContactSync[] = []
  for (const entry of root.entry) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'smb_app_state_sync') continue
      for (const item of change.value?.state_sync ?? []) {
        if (item.type !== 'contact') continue
        const phone = item.contact?.phone_number
        if (!phone) continue
        out.push({
          phone,
          fullName: item.contact?.full_name ?? item.contact?.first_name ?? null,
          action: item.action === 'remove' ? 'remove' : 'add',
        })
      }
    }
  }
  return out
}
