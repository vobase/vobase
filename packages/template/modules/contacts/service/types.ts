/**
 * Contacts service types — agent-facing reader port.
 *
 * `ContactsReader` lives here (not under `agent.ts`) so the type sits next
 * to the service-layer source-of-truth and `agent.ts` stays purely
 * declarative.
 */

import type { Contact } from '../schema'

/** Read-only slice the contacts materializers + index contributor depend on. */
export interface ContactsReader {
  get(id: string): Promise<Contact>
  readMemory(id: string): Promise<string>
}

/** Slice the `/INDEX.md` contacts contributor reads from. */
export interface ContactsIndexReader {
  list(organizationId: string, opts?: { limit?: number }): Promise<Contact[]>
}
