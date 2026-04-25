/**
 * Contacts materializers — `/contacts/<id>/profile.md` (RO identity card) and
 * `/contacts/<id>/MEMORY.md` (agent-writable notes blob, backed by
 * `contacts.contacts.notes`).
 *
 * Declared as a wake-time factory because the paths encode `contactId`. Reads
 * go through `ContactsService` so virtual-field semantics stay in one place.
 */

import type { ContactsService } from '@modules/contacts/service/contacts'
import type { WorkspaceMaterializer } from '@vobase/core'

const EMPTY_MEMORY_MD = '---\n---\n\n# Memory\n\n_empty_\n'

export interface ContactsMaterializerOpts {
  contacts: ContactsService
  contactId: string
}

function contactProfileFallback(contactId: string): string {
  return `# ${contactId} (${contactId})\n\n_No profile configured yet._\n`
}

async function renderContactProfile(port: ContactsService, contactId: string): Promise<string> {
  try {
    const c = await port.get(contactId)
    const identity = c.displayName ?? c.phone ?? c.email ?? c.id
    const lines: string[] = [`# ${identity} (${c.id})`, '']
    if (c.displayName) lines.push(`Display Name: ${c.displayName}`)
    if (c.phone) lines.push(`Phone: ${c.phone}`)
    if (c.email) lines.push(`Email: ${c.email}`)
    lines.push('')
    return lines.join('\n')
  } catch {
    return contactProfileFallback(contactId)
  }
}

async function renderContactMemory(port: ContactsService, contactId: string): Promise<string> {
  try {
    const body = await port.readNotes(contactId)
    return body && body.trim().length > 0 ? body : EMPTY_MEMORY_MD
  } catch {
    return EMPTY_MEMORY_MD
  }
}

export function buildContactsMaterializers(opts: ContactsMaterializerOpts): WorkspaceMaterializer[] {
  return [
    {
      path: `/contacts/${opts.contactId}/profile.md`,
      phase: 'frozen',
      materialize: () => renderContactProfile(opts.contacts, opts.contactId),
    },
    {
      path: `/contacts/${opts.contactId}/MEMORY.md`,
      phase: 'frozen',
      materialize: () => renderContactMemory(opts.contacts, opts.contactId),
    },
  ]
}
