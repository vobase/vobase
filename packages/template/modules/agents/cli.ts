/**
 * `vobase agents {list,show,reload,inspect}` verb registrations.
 *
 * Agent definitions live in the DB and are read fresh per wake — there is no
 * in-memory definition cache. `reload` therefore returns the current row
 * (a confirmation that the next wake will see the latest edits); `inspect`
 * dumps the structured pieces an agent or developer wants to audit
 * (instructions, working memory tail, skill allowlist, model).
 */

import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

import * as agentDefs from './service/agent-definitions'

const PROMPT_TAIL_BYTES = 8 * 1024

function tail(text: string, bytes: number): string {
  if (text.length <= bytes) return text
  return `…(${text.length - bytes} bytes elided)…\n${text.slice(-bytes)}`
}

export const agentsListVerb = defineCliVerb({
  name: 'agents list',
  description: 'List agent definitions in this organization.',
  audience: 'admin',
  input: z.object({}),
  body: async ({ ctx }) => {
    const rows = await agentDefs.list(ctx.organizationId)
    return {
      ok: true as const,
      data: rows.map((a) => ({
        id: a.id,
        name: a.name,
        model: a.model,
        enabled: a.enabled,
        skillAllowlistCount: a.skillAllowlist?.length ?? 0,
        updatedAt: a.updatedAt,
      })),
    }
  },
  formatHint: 'table:cols=id,name,model,enabled,skillAllowlistCount,updatedAt',
})

export const agentsShowVerb = defineCliVerb({
  name: 'agents show',
  description: 'Show a single agent definition by id.',
  audience: 'staff',
  input: z.object({ id: z.string().min(1) }),
  body: async ({ input, ctx }) => {
    try {
      const agent = await agentDefs.getById(input.id)
      if (agent.organizationId !== ctx.organizationId) {
        return { ok: false as const, error: 'agent not in this organization', errorCode: 'forbidden' }
      }
      return { ok: true as const, data: agent }
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

export const agentsReloadVerb = defineCliVerb({
  name: 'agents reload',
  description: "Re-read an agent's definition from the DB; confirms the next wake will see it.",
  audience: 'admin',
  input: z.object({ id: z.string().min(1) }),
  body: async ({ input, ctx }) => {
    try {
      const agent = await agentDefs.getById(input.id)
      if (agent.organizationId !== ctx.organizationId) {
        return { ok: false as const, error: 'agent not in this organization', errorCode: 'forbidden' }
      }
      return {
        ok: true as const,
        data: {
          id: agent.id,
          name: agent.name,
          model: agent.model,
          enabled: agent.enabled,
          updatedAt: agent.updatedAt,
        },
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

export const agentsInspectVerb = defineCliVerb({
  name: 'agents inspect',
  description: 'Dump the agent‘s instructions, working-memory tail, allowed tools, and model.',
  audience: 'admin',
  input: z.object({ id: z.string().min(1) }),
  body: async ({ input, ctx }) => {
    try {
      const agent = await agentDefs.getById(input.id)
      if (agent.organizationId !== ctx.organizationId) {
        return { ok: false as const, error: 'agent not in this organization', errorCode: 'forbidden' }
      }
      return {
        ok: true as const,
        data: {
          id: agent.id,
          name: agent.name,
          model: agent.model,
          enabled: agent.enabled,
          skillAllowlist: agentDefs.resolveAllowedTools({ skillAllowlist: agent.skillAllowlist ?? [] }),
          instructions: agent.instructions ?? '',
          workingMemoryTail: tail(agent.workingMemory ?? '', PROMPT_TAIL_BYTES),
          updatedAt: agent.updatedAt,
        },
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

export const agentsVerbs = [agentsListVerb, agentsShowVerb, agentsReloadVerb, agentsInspectVerb] as const
