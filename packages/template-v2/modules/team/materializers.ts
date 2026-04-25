/**
 * Team materializers — `/staff/<staffId>/profile.md` (RO identity card) and
 * `/staff/<staffId>/MEMORY.md` (agent-writable per-(agent, staff) memory, backed
 * by `agents.agent_staff_memory`).
 *
 * Profile composition order:
 *   1. auth.user (name, email)
 *   2. team.staff_profiles (title, expertise, sectors, availability, …)
 *
 * The first line is always `# <Display Name> (<staffId>)` — identity-in-contents
 * so the agent can resolve id → identity without consulting a side table.
 *
 * Declared as a wake-time factory because staff ids are enumerated per wake
 * (bounded via `team.staff_profiles`) and the paths encode `staffId`.
 */

import { readStaffMemory } from '@modules/agents/service/staff-memory'
import { staff } from '@modules/team/service'
import type { WorkspaceMaterializer } from '@vobase/core'

export interface StaffProfileLookup {
  /** Returns the display name (name, then email, then staffId) for an auth.user row. */
  getAuthDisplay(staffId: string): Promise<{ name: string | null; email: string | null } | null>
}

export interface TeamMaterializerOpts {
  organizationId: string
  agentId: string
  staffIds: readonly string[]
  authLookup: StaffProfileLookup
}

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

export function buildTeamMaterializers(opts: TeamMaterializerOpts): WorkspaceMaterializer[] {
  const mats: WorkspaceMaterializer[] = []
  for (const staffId of opts.staffIds) {
    mats.push({
      path: `/staff/${staffId}/profile.md`,
      phase: 'frozen',
      materialize: () => renderStaffProfile(staffId, opts.authLookup),
    })
    mats.push({
      path: `/staff/${staffId}/MEMORY.md`,
      phase: 'frozen',
      materialize: () => renderStaffMemory({ organizationId: opts.organizationId, agentId: opts.agentId, staffId }),
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
