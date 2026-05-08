/**
 * Agent-facing surfaces for the contacts module. No static tools/listeners/
 * commands — only materializers, which are wake-time (contactId in path).
 *
 * `/contacts/<id>/PROFILE.md` is RO at the workspace level — the body is
 * auto-rendered from the row, and structured edits go through the
 * `vobase contacts propose-change` CLI verb (gated fields queue for staff
 * review; non-gated fields auto-apply with audit history). The companion
 * `/contacts/<id>/MEMORY.md` is direct-writable for agent prose memory,
 * backed by `contacts.contacts.memory` and flushed by the workspace-sync
 * observer at `agent_end`.
 *
 * Reads go through `ContactsService` so virtual-field semantics stay in one
 * place.
 */

import type { Contact } from '@modules/contacts/schema'
import { type AgentTool, defineIndexContributor, type IndexContributor } from '@vobase/core'

import type { WakeMaterializerFactory } from '~/wake/context'
import { DEFAULT_MEMORY_SOFT_CAP_CHARS, renderMemoryWithBudget, stripBudgetHeader } from '~/wake/memory-budget'
import { renderContactFrontmatter } from '~/wake/profile-frontmatter'
import { get as getContact, readMemory as readContactMemory } from './service/contacts'
import type { ContactsIndexReader, ContactsReader } from './service/types'
import { proposeOutreachTool } from './tools/propose-outreach'
import { updateContactTool } from './tools/update-contact'

export type { ContactsIndexReader, ContactsReader }

const contactsReader: ContactsReader = { get: getContact, readMemory: readContactMemory }

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
    const frontmatter = renderContactFrontmatter(c)
    return `${frontmatter}# ${identity} (${c.id})\n`
  } catch {
    return contactProfileFallback(contactId)
  }
}

export async function renderContactMemory(port: ContactsReader, contactId: string): Promise<string> {
  try {
    const raw = await port.readMemory(contactId)
    const body = stripBudgetHeader(raw ?? '')
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
      path: `/contacts/${contactId}/PROFILE.md`,
      phase: 'frozen',
      materialize: () => renderContactProfile(contactsReader, contactId),
    },
    {
      path: `/contacts/${contactId}/MEMORY.md`,
      phase: 'frozen',
      materialize: async () => {
        const body = await renderContactMemory(contactsReader, contactId)
        const header = renderMemoryWithBudget({
          scope: 'contact',
          id: contactId,
          body,
          softCapChars: DEFAULT_MEMORY_SOFT_CAP_CHARS,
        })
        return `${header}${body}`
      },
    },
  ]
}

// ─── AGENTS.md contributor ────────────────────────────────────────────────

const AGENTS_MD_FILE = 'AGENTS.md'

// File-index orientation. PROFILE.md is RO at the workspace level — the
// procedural detail for `propose-change` lives on the verb's own `prompt`
// field (rendered into AGENTS.md `## Commands`). This section just maps
// each file to its mutation path.
export const contactsAgentsMdContributors: readonly IndexContributor[] = [
  defineIndexContributor({
    file: AGENTS_MD_FILE,
    priority: 40,
    name: 'contacts.contact-context',
    render: () => {
      return [
        '## Contact context',
        '',
        '- `/contacts/<id>/PROFILE.md` — contact identity (read-only). Update fields with `vobase contacts propose-change --id <id> --field <name> --to "<value>"` — check the returned `status`.',
        '- `/contacts/<id>/MEMORY.md` — per-contact prose memory. Direct-writable (`echo "- note" >>`). Persists across wakes.',
        '- `/contacts/<id>/drive/` — per-contact upload space (writable).',
      ].join('\n')
    },
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
          lines.push(`- /contacts/${c.id}/PROFILE.md — ${identity} (updated ${new Date(c.updatedAt).toISOString()})`)
        }
        if (recent.length > top.length) lines.push(`- … and ${recent.length - top.length} more`)
        return lines.join('\n')
      },
    }),
  ]
}

export { loadContactsIndexContributors as loadIndexContributors }

export const contactsAgent = {
  tools: contactsTools,
  agentsMd: [...contactsAgentsMdContributors],
  materializers: [contactsMaterializerFactory],
}
