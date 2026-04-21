/**
 * `vobase team …` CLI verbs.
 *
 * Read-only lookups over `modules/team/service/staff` so the agent can see who
 * is on the team before calling `vobase conv reassign` or `vobase conv
 * ask-staff`. Both verbs are in `DEFAULT_READ_ONLY_VERBS` (see dispatcher).
 *
 * Usage:
 *   vobase team list
 *   vobase team get --user=<userId>
 */

import { get as getStaff, list as listStaff } from '@modules/team/service/staff'
import type { CommandDef } from '@server/contracts/plugin-context'

function parseFlags(argv: readonly string[]): Record<string, string> {
  const flags: Record<string, string> = {}
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/s)
    if (m) flags[m[1]] = m[2]
  }
  return flags
}

function formatRow(s: {
  userId: string
  displayName: string | null
  title: string | null
  expertise: string[]
  languages: string[]
  availability: string
}): string {
  const name = s.displayName ?? '(unnamed)'
  const title = s.title ? ` · ${s.title}` : ''
  const expertise = s.expertise.length > 0 ? ` · skills=${s.expertise.join(',')}` : ''
  return `  user:${s.userId}  ${name}${title} · availability=${s.availability}${expertise}`
}

export const teamVerbs: readonly CommandDef[] = [
  {
    name: 'team list',
    description: 'List staff on this organization (name, title, availability, expertise).',
    usage: 'vobase team list',

    async execute(_argv, ctx) {
      const rows = await listStaff(ctx.organizationId)
      if (rows.length === 0) return { ok: true, content: 'No staff on this organization.' }
      const lines = ['Staff:', ...rows.map(formatRow)]
      return { ok: true, content: lines.join('\n') }
    },
  },
  {
    name: 'team get',
    description: 'Show a single staff profile (title, availability, expertise, profile notes).',
    usage: 'vobase team get --user=<userId>',

    async execute(argv, _ctx) {
      const flags = parseFlags(argv)
      const userId = flags.user
      if (!userId) return { ok: false, error: 'missing required flag --user' }

      try {
        const s = await getStaff(userId)
        const parts = [
          `user:${s.userId}  ${s.displayName ?? '(unnamed)'}`,
          s.title ? `title: ${s.title}` : null,
          `availability: ${s.availability}`,
          s.expertise.length > 0 ? `expertise: ${s.expertise.join(', ')}` : null,
          s.languages.length > 0 ? `languages: ${s.languages.join(', ')}` : null,
          s.sectors.length > 0 ? `sectors: ${s.sectors.join(', ')}` : null,
          s.profile ? `\nprofile:\n${s.profile}` : null,
        ].filter((x): x is string => x !== null)
        return { ok: true, content: parts.join('\n') }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  },
]
