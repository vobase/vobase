/**
 * Agent-facing surfaces for the contacts module. No static tools/listeners/
 * commands — only materializers, which are wake-time (contactId in path).
 *
 * `/contacts/<id>/profile.md` (frontmatter is the agent's structured-edit
 * surface for scalar columns + `attributes.*`; body below the second `---`
 * is auto-rendered) and `/contacts/<id>/MEMORY.md` (agent-writable memory
 * blob, backed by `contacts.contacts.memory`).
 *
 * Reads go through `ContactsService` so virtual-field semantics stay in one
 * place. Frontmatter writes are observed by `wake/observers/workspace-sync`
 * and translated into `field_set` change-proposals.
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
      path: `/contacts/${contactId}/profile.md`,
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

export const contactsAgentsMdContributors: readonly IndexContributor[] = [
  defineIndexContributor({
    file: AGENTS_MD_FILE,
    priority: 40,
    name: 'contacts.contact-context',
    render: () =>
      [
        '## Contact context',
        '',
        "- `/contacts/<id>/profile.md` — contact identity. The YAML frontmatter at the top is editable: top-level scalars (`displayName`, `email`, `phone`, `segments`, `marketingOptOut`) and nested `attributes.*` keys flow through the change-proposal pipeline as `field_set` proposals. The body below the second `---` is auto-rendered from the row — don't edit it.",
        '- `/contacts/<id>/MEMORY.md` — per-contact working memory (prose narrative). Direct-writable like any markdown file (`cat`, `echo >>`, `sed`, heredocs). Persists across wakes — use for per-customer learnings that should survive into future conversations.',
        '- `/contacts/<id>/drive/` — per-contact upload space (writable).',
        '',
        '**Update structured fields:** edit the frontmatter atop `profile.md` (e.g. `attributes.industry: "logistics"`). **Update prose memory:** `echo "- new note" >> /contacts/<id>/MEMORY.md`.',
        '',
        '**When the customer asks for a profile change** (email, phone, displayName, segments, attributes), the workflow is mandatory and must happen IN THIS WAKE — do not punt to "I\'ll log it for staff" without doing the work:',
        '1. `cat /contacts/<id>/profile.md` to see which keys are present in the frontmatter.',
        '2. Edit with `sed`/`echo`/here-doc — see the **Bash sandbox** section in the static instructions for the exact insert-or-replace patterns. A new contact often has only `displayName` + `marketingOptOut`, so a plain "replace existing key" sed for `email` will silently match nothing — use the insert pattern.',
        '3. `cat` the file again to confirm your edit landed.',
        '4. Read the `stderr` of your edit. Gated fields (`displayName`, `email`) emit a `vobase notice:` line saying the change is queued for staff approval. Non-gated fields apply immediately.',
        '5. Reply to the customer based on step 4: "logged for our team to review" for gated fields with the notice; "all set" for non-gated fields. Never invent a "logged" reply without a verified edit and an actual stderr notice in your tool result.',
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

export const contactsAgent = {
  tools: contactsTools,
  agentsMd: [...contactsAgentsMdContributors],
  materializers: [contactsMaterializerFactory],
}
