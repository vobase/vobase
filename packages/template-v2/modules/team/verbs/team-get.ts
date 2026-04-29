/**
 * `vobase team get` — show a single staff profile (title, availability,
 * expertise, languages, sectors, profile notes). Pure read.
 */

import { staff } from '@modules/team/service'
import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

export const teamGetVerb = defineCliVerb({
  name: 'team get',
  description: 'Show a single staff profile (title, availability, expertise, profile notes).',
  readOnly: true,
  prompt:
    'Use after `vobase team list` when you need full profile detail (sectors, languages, profile notes) for one staff member — e.g. picking the best fit for a `conv reassign`.',
  input: z.object({ user: z.string().min(1) }),
  body: async ({ input }) => {
    try {
      const s = await staff.get(input.user)
      const parts = [
        `user:${s.userId}  ${s.displayName ?? '(unnamed)'}`,
        s.title ? `title: ${s.title}` : null,
        `availability: ${s.availability}`,
        s.expertise.length > 0 ? `expertise: ${s.expertise.join(', ')}` : null,
        s.languages.length > 0 ? `languages: ${s.languages.join(', ')}` : null,
        s.sectors.length > 0 ? `sectors: ${s.sectors.join(', ')}` : null,
        s.profile ? `\nprofile:\n${s.profile}` : null,
      ].filter((x): x is string => x !== null)
      return {
        ok: true as const,
        data: {
          userId: s.userId,
          displayName: s.displayName,
          title: s.title,
          availability: s.availability,
          expertise: s.expertise,
          languages: s.languages,
          sectors: s.sectors,
          profile: s.profile,
        },
        summary: parts.join('\n'),
      }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        errorCode: 'not_found',
      }
    }
  },
  formatHint: 'json',
})
