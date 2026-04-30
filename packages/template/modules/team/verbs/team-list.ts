/**
 * `vobase team list` — list staff on the org (name, title, availability,
 * expertise). Pure read, callable from both the agent's bash sandbox AND a
 * human running the binary. Audience defaults to `'all'`.
 */

import { staff } from '@modules/team/service'
import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

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

export const teamListVerb = defineCliVerb({
  name: 'team list',
  description: 'List staff on this organization (name, title, availability, expertise).',
  readOnly: true,
  prompt:
    'Always run before `conv reassign --to=user:...` or `conv ask-staff --mention=...` so you use real userIds. Cheap, read-only.',
  input: z.object({}),
  body: async ({ ctx }) => {
    const rows = await staff.list(ctx.organizationId)
    if (rows.length === 0) {
      return { ok: true as const, data: { staff: [] }, summary: 'No staff on this organization.' }
    }
    return {
      ok: true as const,
      data: {
        staff: rows.map((s) => ({
          userId: s.userId,
          displayName: s.displayName,
          title: s.title,
          availability: s.availability,
          expertise: s.expertise,
          languages: s.languages,
        })),
      },
      summary: ['Staff:', ...rows.map(formatRow)].join('\n'),
    }
  },
  formatHint: 'json',
})
