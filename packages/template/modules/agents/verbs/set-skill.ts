/**
 * `vobase agents set-skill` — admin verb to upsert a row in
 * `agents.learned_skills` keyed on `(organizationId, agentId, name)`.
 *
 * The skill body materializes at `/agents/<id>/skills/<name>/SKILL.md`
 * via the drive overlay — but only when `name` is also in the agent's
 * `skill_allowlist`. Pair with `agents set-allowlist` to actually surface
 * a newly-added skill to the agent.
 *
 * `--file=<localPath>` is **client-side**: the CLI binary's resolver reads
 * the operator-local file and rewrites it to `--body=<contents>` before
 * dispatch (mirroring set-instructions). Server-side only `body` is
 * accepted.
 *
 * Re-running with the same `--name` updates in place and increments
 * `version` by one. `description` / `tags` are preserved across updates
 * when omitted; the columns `parentProposalId` and `threatScanReport` are
 * never touched (those belong to the proposal flow, not this scripted
 * write).
 */

import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

import * as agentDefs from '../service/agent-definitions'
import { upsertLearnedSkill } from '../service/changes'

export const agentsSetSkillVerb = defineCliVerb({
  name: 'agents set-skill',
  description:
    "Upsert a learned-skill SKILL.md body for an agent. The skill surfaces at /agents/<id>/skills/<name>/SKILL.md only when its name is also in the agent's allowlist (set via `agents set-allowlist`). Provide --body=<text> or --file=<localPath>.",
  audience: 'admin',
  usage:
    'vobase agents set-skill --id=<agentId> --name=<slug> (--body=<text> | --file=<localPath>) [--description=<text>] [--tags=<csv>]',
  input: z.object({
    id: z.string().min(1),
    name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/u, 'slug-case: lowercase, digits, hyphens'),
    /** The resolver translates `--file=<path>` into `body=<contents>` client-side. */
    body: z.string().min(1, '--body or --file is required and must be non-empty'),
    description: z.string().max(500).optional(),
    /** CSV — parsed in body. Omit to leave existing tags untouched. */
    tags: z.string().optional(),
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

    const tags = input.tags
      ? input.tags
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : undefined

    try {
      const row = await upsertLearnedSkill({
        organizationId: agent.organizationId,
        agentId: input.id,
        name: input.name,
        body: input.body,
        description: input.description,
        tags,
      })
      const inAllowlist = (agent.skillAllowlist ?? []).includes(input.name)
      return {
        ok: true as const,
        data: {
          id: row.id,
          agentId: row.agentId,
          name: row.name,
          version: row.version,
          bytes: row.body.length,
          inAllowlist,
          updatedAt: row.updatedAt,
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
