/**
 * `vobase agents remove-skill` — admin verb to delete a row from
 * `agents.learned_skills` keyed on `(organizationId, agentId, name)`.
 *
 * Trimming `skill_allowlist` alone is NOT enough to hide a skill: the
 * drive overlay (`modules/agents/service/drive-overlay.ts`) lists a
 * `/skills/<name>/SKILL.md` file for every learned-row backed skill,
 * regardless of allowlist. To truly disappear an obsolete skill, the
 * row has to go. This verb is the operator's seam for that during
 * scripted rewrites; pair with `agents set-allowlist` to keep the
 * allowed-skill set in sync.
 *
 * Idempotent: re-running with a name that no longer exists returns
 * `{ deleted: 0 }` without erroring.
 */

import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

import * as agentDefs from '../service/agent-definitions'
import { removeLearnedSkill } from '../service/changes'

export const agentsRemoveSkillVerb = defineCliVerb({
  name: 'agents remove-skill',
  description:
    "Delete a learned-skill row for an agent. Idempotent — returns deleted:0 when the skill isn't present. Pair with `agents set-allowlist` to keep the allow-listed set consistent.",
  audience: 'admin',
  usage: 'vobase agents remove-skill --id=<agentId> --name=<slug>',
  input: z.object({
    id: z.string().min(1),
    name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/u, 'slug-case: lowercase, digits, hyphens'),
  }),
  body: async ({ input, ctx }) => {
    let agent: Awaited<ReturnType<typeof agentDefs.getById>>
    try {
      agent = await agentDefs.getById(input.id)
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : `agent "${input.id}" not found`,
        errorCode: 'not_found',
      }
    }
    if (agent.organizationId !== ctx.organizationId) {
      return { ok: false as const, error: 'agent not in this organization', errorCode: 'forbidden' }
    }

    const { deleted } = await removeLearnedSkill({
      organizationId: agent.organizationId,
      agentId: input.id,
      name: input.name,
    })
    const stillInAllowlist = (agent.skillAllowlist ?? []).includes(input.name)
    return {
      ok: true as const,
      data: { agentId: input.id, name: input.name, deleted, stillInAllowlist },
    }
  },
  formatHint: 'json',
})
