/**
 * `vobase agents set-allowlist` — admin verb to replace an agent's
 * `skill_allowlist` array wholesale. Used during scripted agent rewrites
 * to drop obsolete skills and lock in a new shortlist in one shot.
 *
 * `--skills` is a comma-separated list of skill names (e.g.
 * `bash,vobase,my-skill`). Passing `--skills=` (empty) clears the
 * allowlist. The verb only flips the visibility gate; skill bodies live in
 * `agents.learned_skills` and are mounted at `/agents/<id>/skills/<name>/`
 * only when the name also appears in this allowlist.
 *
 * Writes go through `agentDefs.update()` — same writer as set-instructions /
 * set-working-memory. The next wake re-reads `agent_definitions` and the
 * drive overlay surfaces the updated allowlist with no further wiring.
 */

import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

import * as agentDefs from '../service/agent-definitions'

export const agentsSetAllowlistVerb = defineCliVerb({
  name: 'agents set-allowlist',
  description:
    "Replace an agent's skill allowlist. --skills is a comma-separated list of skill names (empty string clears the allowlist).",
  audience: 'admin',
  usage: 'vobase agents set-allowlist --id=<agentId> --skills=<csv>',
  input: z.object({
    id: z.string().min(1),
    /** CSV — parsed in body so empty string means "clear". */
    skills: z.string(),
  }),
  body: async ({ input, ctx }) => {
    const skills = input.skills
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    try {
      const existing = await agentDefs.getById(input.id)
      if (existing.organizationId !== ctx.organizationId) {
        return { ok: false as const, error: 'agent not in this organization', errorCode: 'forbidden' }
      }
      const updated = await agentDefs.update(input.id, { skillAllowlist: skills })
      return {
        ok: true as const,
        data: {
          id: updated.id,
          name: updated.name,
          skillAllowlist: updated.skillAllowlist ?? [],
          updatedAt: updated.updatedAt,
        },
      }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        errorCode: 'update_failed',
      }
    }
  },
  formatHint: 'json',
})
