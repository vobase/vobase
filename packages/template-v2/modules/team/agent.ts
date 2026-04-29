/**
 * Agent-facing surfaces for the team module.
 *
 * Materializers are wake-time factories — staff ids are wake-time data. They
 * render `/staff/<staffId>/profile.md` (RO identity card) and
 * `/staff/<staffId>/MEMORY.md` (agent-writable per-(agent, staff) memory,
 * backed by `agents.agent_staff_memory`).
 *
 * Profile composition order:
 *   1. auth.user (name, email)
 *   2. team.staff_profiles (title, expertise, sectors, availability, …)
 *
 * The first line is always `# <Display Name> (<staffId>)` — identity-in-contents
 * so the agent can resolve id → identity without consulting a side table.
 *
 * The agent-bash verbs `team list` / `team get` now live as `defineCliVerb`
 * definitions under `./verbs/`. Both the wake's bash sandbox and the runtime
 * CLI binary dispatch through the same `CliVerbRegistry`.
 */

import { readStaffMemory } from '@modules/agents/service/staff-memory'
import { staff } from '@modules/team/service'
import type { StaffProfileLookup } from '@modules/team/service/types'
import type { IndexContributor, RoHintFn, WorkspaceMaterializer } from '@vobase/core'
import { defineIndexContributor } from '@vobase/core'

import type { WakeMaterializerFactory } from '~/wake/context'

export type { StaffProfileLookup }

const AGENTS_MD_FILE = 'AGENTS.md'

// Cross-cutting prose only — describes the staff FILES the agent reads.
// Per-verb guidance (when to use `team list` vs `team get`) lives next to
// each verb's `defineCliVerb` and renders under `## Commands` in AGENTS.md.
/**
 * RO-error hint for `/staff/<staffId>/profile.md`. The staff profile is
 * derived from the auth user + staff_profiles record; agents edit fields in
 * the Team UI rather than overwriting the rendered file.
 */
export const teamRoHints: RoHintFn[] = [
  (path) => {
    if (path.startsWith('/staff/') && path.endsWith('/profile.md')) {
      return `bash: ${path}: Read-only filesystem.\n  Staff profile is derived from the staff record (display name, role, expertise, timezone). Edit fields in the Team UI; do not write to this file.`
    }
    return null
  },
]

export const teamAgentsMdContributors: readonly IndexContributor[] = [
  defineIndexContributor({
    file: AGENTS_MD_FILE,
    priority: 60,
    name: 'team.staff-roster',
    render: () =>
      [
        '## Staff',
        '',
        '- `/staff/<id>/profile.md` — staff identity (read-only; first line carries the identity).',
        '- `/staff/<id>/MEMORY.md` — per-(agent, staff) memory you maintain about that staff member. Direct-writable.',
      ].join('\n'),
  }),
]

export async function renderStaffProfile(staffId: string, authLookup: StaffProfileLookup): Promise<string> {
  const [profile, auth] = await Promise.all([
    staff.find(staffId).catch(() => null),
    authLookup.getAuthDisplay(staffId).catch(() => null),
  ])
  const displayName = profile?.displayName ?? auth?.name ?? auth?.email ?? staffId
  const lines: string[] = [`# ${displayName} (${staffId})`, '']
  if (auth?.email) lines.push(`Email: ${auth.email}`)
  if (profile?.title) lines.push(`Title: ${profile.title}`)
  if (profile?.availability) lines.push(`Availability: ${profile.availability}`)
  if (profile && profile.expertise.length > 0) lines.push(`Expertise: ${profile.expertise.join(', ')}`)
  if (profile && profile.sectors.length > 0) lines.push(`Sectors: ${profile.sectors.join(', ')}`)
  if (profile && profile.languages.length > 0) lines.push(`Languages: ${profile.languages.join(', ')}`)
  if (profile?.profile && profile.profile.trim().length > 0) {
    lines.push('', '## Profile', '', profile.profile.trimEnd())
  }
  lines.push('')
  return lines.join('\n')
}

export async function renderStaffMemory(key: {
  organizationId: string
  agentId: string
  staffId: string
}): Promise<string> {
  const content = await readStaffMemory(key)
  if (content.trim().length > 0) return content
  return '---\n---\n\n# Memory\n\n_empty_\n'
}

/**
 * Team materializer factory — emits `/staff/<id>/profile.md` (RO identity)
 * and `/staff/<id>/MEMORY.md` (per-(agent, staff) memory) for every staff
 * id resolved by the wake builder.
 */
export const teamMaterializerFactory: WakeMaterializerFactory = (ctx) => {
  const mats: WorkspaceMaterializer[] = []
  for (const staffId of ctx.staffIds) {
    mats.push({
      path: `/staff/${staffId}/profile.md`,
      phase: 'frozen',
      materialize: () => renderStaffProfile(staffId, ctx.authLookup),
    })
    mats.push({
      path: `/staff/${staffId}/MEMORY.md`,
      phase: 'frozen',
      materialize: () => renderStaffMemory({ organizationId: ctx.organizationId, agentId: ctx.agentId, staffId }),
    })
  }
  return mats
}

/** Convenience for tests: predictable stub when only profile data is passed inline. */
export function makeStaticProfileLookup(
  rows: Record<string, { name: string | null; email: string | null }>,
): StaffProfileLookup {
  return {
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async getAuthDisplay(staffId) {
      return rows[staffId] ?? null
    },
  }
}
