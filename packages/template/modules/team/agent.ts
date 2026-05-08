/**
 * Agent-facing surfaces for the team module.
 *
 * Materializers are wake-time factories — staff ids are wake-time data. They
 * render `/staff/<staffId>/PROFILE.md` (RO identity card) and
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
import type { IndexContributor, WorkspaceMaterializer } from '@vobase/core'
import { defineIndexContributor } from '@vobase/core'

import type { WakeMaterializerFactory } from '~/wake/context'
import { DEFAULT_MEMORY_SOFT_CAP_CHARS, renderMemoryWithBudget, stripBudgetHeader } from '~/wake/memory-budget'
import { renderStaffFrontmatter } from '~/wake/profile-frontmatter'

export type { StaffProfileLookup }

const AGENTS_MD_FILE = 'AGENTS.md'

export const teamAgentsMdContributors: readonly IndexContributor[] = [
  defineIndexContributor({
    file: AGENTS_MD_FILE,
    priority: 60,
    name: 'team.staff-roster',
    render: () => {
      return [
        '## Staff',
        '',
        '- `/staff/<id>/PROFILE.md` — staff identity (read-only).',
        '- `/staff/<id>/MEMORY.md` — per-(agent, staff) notes you maintain. Direct-writable.',
      ].join('\n')
    },
  }),
]

export async function renderStaffProfile(staffId: string, authLookup: StaffProfileLookup): Promise<string> {
  const [profile, auth] = await Promise.all([
    staff.find(staffId).catch(() => null),
    authLookup.getAuthDisplay(staffId).catch(() => null),
  ])
  const displayName = profile?.displayName ?? auth?.name ?? auth?.email ?? staffId
  const frontmatter = profile ? renderStaffFrontmatter(profile) : '---\n---\n\n'
  return `${frontmatter}# ${displayName} (${staffId})\n`
}

export async function renderStaffMemory(key: {
  organizationId: string
  agentId: string
  staffId: string
}): Promise<string> {
  const raw = await readStaffMemory(key)
  const content = stripBudgetHeader(raw)
  if (content.trim().length > 0) return content
  return '---\n---\n\n# Memory\n\n_empty_\n'
}

/**
 * Team materializer factory — emits `/staff/<id>/PROFILE.md` (RO identity)
 * and `/staff/<id>/MEMORY.md` (per-(agent, staff) memory) for every staff
 * id resolved by the wake builder.
 *
 * The MEMORY.md output is body-materialized for every `ctx.staffIds` entry
 * (full workspace surface, unchanged). Budget headers are prepended ONLY for
 * the subset in `ctx.budgetHeaderStaffIds` (capped upstream in
 * `wake/build-base.ts::capStaffIdsForBudgetHeader`) so per-wake header cost
 * stays bounded as the staff roster grows.
 */
export const teamMaterializerFactory: WakeMaterializerFactory = (ctx) => {
  const mats: WorkspaceMaterializer[] = []
  const budgetSet = new Set(ctx.budgetHeaderStaffIds)
  for (const staffId of ctx.staffIds) {
    mats.push({
      path: `/staff/${staffId}/PROFILE.md`,
      phase: 'frozen',
      materialize: () => renderStaffProfile(staffId, ctx.authLookup),
    })
    const includeBudgetHeader = budgetSet.has(staffId)
    mats.push({
      path: `/staff/${staffId}/MEMORY.md`,
      phase: 'frozen',
      materialize: async () => {
        const body = await renderStaffMemory({
          organizationId: ctx.organizationId,
          agentId: ctx.agentId,
          staffId,
        })
        if (!includeBudgetHeader) return body
        const header = renderMemoryWithBudget({
          scope: 'staff',
          id: staffId,
          body,
          softCapChars: DEFAULT_MEMORY_SOFT_CAP_CHARS,
        })
        return `${header}${body}`
      },
    })
  }
  return mats
}

export const teamAgent = {
  agentsMd: [...teamAgentsMdContributors],
  materializers: [teamMaterializerFactory],
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
