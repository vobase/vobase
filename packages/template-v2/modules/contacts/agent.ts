/**
 * Agent-facing surfaces for the contacts module. No static tools/listeners/
 * commands — only materializers, which are wake-time (contactId in path).
 *
 * `/contacts/<id>/profile.md` (RO identity card) and `/contacts/<id>/MEMORY.md`
 * (agent-writable memory blob, backed by `contacts.contacts.memory`).
 *
 * Reads go through `ContactsService` so virtual-field semantics stay in one
 * place.
 */

import type { Contact } from '@modules/contacts/schema'
import type { ContactsService } from '@modules/contacts/service/contacts'
import { defineIndexContributor, type IndexContributor, type WorkspaceMaterializer } from '@vobase/core'

const EMPTY_MEMORY_MD = '---\n---\n\n# Memory\n\n_empty_\n'

/** Read-only slice of ContactsService the profile + memory materializers depend on. */
export type ContactsReader = Pick<ContactsService, 'get' | 'readMemory'>

export interface ContactsMaterializerOpts {
  contacts: ContactsReader
  contactId: string
}

function contactProfileFallback(contactId: string): string {
  return `# ${contactId} (${contactId})\n\n_No profile configured yet._\n`
}

async function renderContactProfile(port: ContactsReader, contactId: string): Promise<string> {
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

async function renderContactMemory(port: ContactsReader, contactId: string): Promise<string> {
  try {
    const body = await port.readMemory(contactId)
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

export { buildContactsMaterializers as buildMaterializers }

// ─── Index contributors ────────────────────────────────────────────────────

export type ContactsIndexReader = Pick<ContactsService, 'list'>

export interface ContactsIndexContributorOpts {
  organizationId: string
  contacts: ContactsIndexReader
  /** Recency window in milliseconds. Defaults to 24h. */
  recentMs?: number
}

const INDEX_FILE = 'INDEX.md'
const INDEX_RECENT_CONTACTS_LIMIT = 10
const DEFAULT_RECENT_WINDOW_MS = 24 * 60 * 60 * 1000

export async function loadContactsIndexContributors(opts: ContactsIndexContributorOpts): Promise<IndexContributor[]> {
  const all = (await opts.contacts.list(opts.organizationId).catch(() => [])) as Contact[]
  const recencyWindowMs = opts.recentMs ?? DEFAULT_RECENT_WINDOW_MS
  const cutoff = Date.now() - recencyWindowMs
  const recent = all
    .filter((c) => c.updatedAt && new Date(c.updatedAt).getTime() >= cutoff)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  return [
    defineIndexContributor({
      file: INDEX_FILE,
      priority: 300,
      name: 'contacts.recentActivity',
      render: () => {
        if (recent.length === 0) return null
        const top = recent.slice(0, INDEX_RECENT_CONTACTS_LIMIT)
        const hours = Math.round(recencyWindowMs / (60 * 60 * 1000))
        const lines = [`# Recent Contact Activity (last ${hours}h, ${recent.length})`, '']
        for (const c of top) {
          const identity = c.displayName ?? c.phone ?? c.email ?? c.id
          lines.push(`- /contacts/${c.id}/profile.md — ${identity} (updated ${new Date(c.updatedAt).toISOString()})`)
        }
        if (recent.length > top.length) lines.push(`- … and ${recent.length - top.length} more`)
        return lines.join('\n')
      },
    }),
  ]
}

export { loadContactsIndexContributors as loadIndexContributors }
