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
import { type AgentTool, defineIndexContributor, type IndexContributor, type RoHintFn } from '@vobase/core'

import type { WakeMaterializerFactory } from '~/wake/context'
import { get as getContact, readMemory as readContactMemory } from './service/contacts'
import type { ContactsIndexReader, ContactsReader } from './service/types'
import { proposeOutreachTool } from './tools/propose-outreach'
import { updateContactTool } from './tools/update-contact'

export type { ContactsIndexReader, ContactsReader }

const contactsReader: ContactsReader = { get: getContact, readMemory: readContactMemory }

/**
 * RO-error hint for `/contacts/<id>/profile.md`. The contact profile is
 * derived from the contacts row; agents propose changes via `update_contact`
 * (gated by the changes pipeline) instead of overwriting the file.
 */
export const contactsRoHints: RoHintFn[] = [
  (path) => {
    if (path.startsWith('/contacts/') && path.endsWith('/profile.md')) {
      return `bash: ${path}: Read-only filesystem.\n  Contact profile is derived from the contact record. Edit fields in the Contacts UI or via the contacts service; do not write to this file.`
    }
    return null
  },
]

export const contactsTools: AgentTool[] = [updateContactTool, proposeOutreachTool]

export { proposeOutreachTool, updateContactTool }

const EMPTY_MEMORY_MD = '---\n---\n\n# Memory\n\n_empty_\n'

function contactProfileFallback(contactId: string): string {
  return `# ${contactId} (${contactId})\n\n_No profile configured yet._\n`
}

export async function renderContactProfile(port: ContactsReader, contactId: string): Promise<string> {
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

export async function renderContactMemory(port: ContactsReader, contactId: string): Promise<string> {
  try {
    const body = await port.readMemory(contactId)
    return body && body.trim().length > 0 ? body : EMPTY_MEMORY_MD
  } catch {
    return EMPTY_MEMORY_MD
  }
}

export const contactsMaterializerFactory: WakeMaterializerFactory = (ctx) => {
  if (!ctx.contactId) return []
  const contactId = ctx.contactId
  return [
    {
      path: `/contacts/${contactId}/profile.md`,
      phase: 'frozen',
      materialize: () => renderContactProfile(contactsReader, contactId),
    },
    {
      path: `/contacts/${contactId}/MEMORY.md`,
      phase: 'frozen',
      materialize: () => renderContactMemory(contactsReader, contactId),
    },
  ]
}

// ─── AGENTS.md contributor ────────────────────────────────────────────────

const AGENTS_MD_FILE = 'AGENTS.md'

export const contactsAgentsMdContributors: readonly IndexContributor[] = [
  defineIndexContributor({
    file: AGENTS_MD_FILE,
    priority: 40,
    name: 'contacts.contact-context',
    render: () =>
      [
        '## Contact context',
        '',
        '- `/contacts/<id>/profile.md` — contact identity (read-only; first line carries the identity).',
        '- `/contacts/<id>/MEMORY.md` — per-contact working memory. Direct-writable like any markdown file (`cat`, `echo >>`, `sed`, heredocs). Persists across wakes — use for per-customer learnings that should survive into future conversations.',
        '- `/contacts/<id>/drive/` — per-contact upload space (writable).',
        '',
        '**Update contact memory:** `echo "- new note" >> /contacts/<id>/MEMORY.md`, or use a heredoc for a dated section. Same pattern as your own MEMORY.md, scoped to this contact.',
      ].join('\n'),
  }),
]

// ─── Index contributors (INDEX.md) ────────────────────────────────────────

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
