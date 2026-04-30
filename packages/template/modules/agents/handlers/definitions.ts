/**
 * /api/agents/definitions — CRUD for agent_definitions.
 *
 *   GET    /definitions        — list for org
 *   POST   /definitions        — create
 *   GET    /definitions/:id    — fetch single (full row)
 *   PATCH  /definitions/:id    — partial update (name/model/enabled/instructions/workingMemory)
 *   DELETE /definitions/:id    — delete
 */

import type { AuthLookup } from '@auth/lookup'
import { type OrganizationEnv, requireOrganization } from '@auth/middleware'
import { zValidator } from '@hono/zod-validator'
import { agentsMaterializerFactory } from '@modules/agents/agent'
import type { AgentDefinition } from '@modules/agents/schema'
import { getAgentContributions } from '@modules/agents/service/agent-contributions'
import {
  create as createAgent,
  getById,
  list as listAgents,
  remove as removeAgent,
  update as updateAgent,
} from '@modules/agents/service/agent-definitions'
import type { FilesService } from '@modules/drive/service/files'
import type { WakeAudienceTier } from '@vobase/core'
import { Hono } from 'hono'
import { z } from 'zod'

import type { LaneName, SupervisorKind } from '~/wake/agents-md-scratch'
import type { WakeContext } from '~/wake/context'

const createBody = z.object({
  name: z.string().min(1).max(120),
  model: z.string().min(1).max(120).optional(),
  instructions: z.string().optional(),
  workingMemory: z.string().optional(),
  enabled: z.boolean().optional(),
})

const updateBody = z.object({
  name: z.string().min(1).max(120).optional(),
  model: z.string().min(1).max(120).optional(),
  instructions: z.string().optional(),
  workingMemory: z.string().optional(),
  enabled: z.boolean().optional(),
})

/**
 * Lane-preview query. `lane` + `triggerKind` are sufficient for every
 * variant except conversation/supervisor, where `supervisorKind` selects
 * coaching vs ask-staff-answer. Defaults to a conversation/inbound_message
 * preview to match the historical (pre-lane-switcher) behaviour.
 */
const previewQuery = z
  .object({
    lane: z.enum(['conversation', 'standalone']).default('conversation'),
    triggerKind: z
      .enum([
        'inbound_message',
        'supervisor',
        'approval_resumed',
        'scheduled_followup',
        'manual',
        'operator_thread',
        'heartbeat',
      ])
      .default('inbound_message'),
    supervisorKind: z.enum(['coaching', 'ask_staff_answer']).optional(),
  })
  .superRefine((q, ctx) => {
    // Lane × triggerKind compatibility — silent coercion would mask UI bugs
    // (e.g. a frontend that forgets to clear `triggerKind` when switching
    // lanes). Reject explicitly so the caller fixes the request.
    const standaloneKinds: ReadonlyArray<typeof q.triggerKind> = ['operator_thread', 'heartbeat']
    if (q.lane === 'standalone' && !standaloneKinds.includes(q.triggerKind)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'triggerKind not valid for standalone lane' })
    }
    if (q.lane === 'conversation' && standaloneKinds.includes(q.triggerKind)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'triggerKind not valid for conversation lane' })
    }
    if (q.supervisorKind && q.triggerKind !== 'supervisor') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'supervisorKind only applies when triggerKind=supervisor' })
    }
  })

type PreviewQuery = z.infer<typeof previewQuery>

/**
 * Render the AGENTS.md the agent would see for a given lane variant. Builds
 * a synthetic `WakeContext` with the lane-filtered tool catalogue and the
 * boot-time AGENTS.md contributors so module-side lane-aware blocks (e.g.
 * messaging's supervisor-coaching prose) appear in the right cases.
 *
 * Drive / staff / auth handles are stubbed because the AGENTS.md
 * materializer never reads them — only the messages.md / profile.md
 * materializers do, and those don't fire here. Type-safety satisfied;
 * runtime never touches them.
 */
function renderPreviewAgentsMd(input: {
  agentDefinition: AgentDefinition
  organizationId: string
  lane: LaneName
  triggerKind: PreviewQuery['triggerKind']
  supervisorKind?: SupervisorKind
}): string {
  const contributions = getAgentContributions()

  // Mirrors `wake/conversation.ts` + `wake/standalone.ts`. Coaching wakes
  // also strip `audience: 'customer'` tools so the preview shows what the
  // harness actually surfaces under that condition.
  const laneTools = contributions.tools.filter((t) => t.lane === input.lane || t.lane === 'both')
  const previewTools =
    input.supervisorKind === 'coaching' ? laneTools.filter((t) => t.audience !== 'customer') : laneTools

  const audienceTier: WakeAudienceTier =
    input.lane === 'conversation' && input.triggerKind === 'inbound_message' ? 'contact' : 'staff'

  const wakeCtx: WakeContext = {
    organizationId: input.organizationId,
    agentId: input.agentDefinition.id,
    conversationId: input.lane === 'conversation' ? 'preview-conversation' : `preview-${input.triggerKind}`,
    drive: {} as FilesService,
    staffIds: [],
    authLookup: { getAuthDisplay: async () => null } as AuthLookup,
    agentDefinition: input.agentDefinition,
    tools: previewTools,
    agentsMdContributors: contributions.agentsMd,
    lane: input.lane,
    triggerKind: input.triggerKind,
    supervisorKind: input.supervisorKind,
    audienceTier,
  }

  const materializers = agentsMaterializerFactory(wakeCtx)
  const agentsMdEntry = materializers.find((m) => m.path === `/agents/${input.agentDefinition.id}/AGENTS.md`)
  if (!agentsMdEntry) throw new Error('AGENTS.md materializer not found in agents factory output')
  // The agents AGENTS.md materializer closes over the rendered markdown
  // (computed during the factory call) and ignores its `MaterializerCtx`
  // argument. Pass a minimal stub purely to satisfy the type signature.
  const out = agentsMdEntry.materialize({
    organizationId: input.organizationId,
    agentId: input.agentDefinition.id,
    conversationId: wakeCtx.conversationId,
    contactId: '',
    turnIndex: 0,
  })
  return typeof out === 'string' ? out : ''
}

const app = new Hono<OrganizationEnv>()
  .use('*', requireOrganization)
  .get('/definitions', async (c) => {
    const rows = await listAgents(c.get('organizationId'))
    return c.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        model: r.model,
        enabled: r.enabled,
        updatedAt: r.updatedAt,
      })),
    )
  })
  .post(
    '/definitions',
    zValidator('json', createBody, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
      }
    }),
    async (c) => {
      const data = c.req.valid('json')
      const row = await createAgent({ organizationId: c.get('organizationId'), ...data })
      return c.json(row, 201)
    },
  )
  .get('/definitions/:id', async (c) => {
    try {
      const row = await getById(c.req.param('id'))
      if (row.organizationId !== c.get('organizationId')) return c.json({ error: 'not_found' }, 404)
      return c.json(row)
    } catch {
      return c.json({ error: 'not_found' }, 404)
    }
  })
  .get(
    '/definitions/:id/agents-md',
    zValidator('query', previewQuery, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'invalid_query', issues: result.error.issues }, 400)
      }
    }),
    async (c) => {
      try {
        const row = await getById(c.req.param('id'))
        if (row.organizationId !== c.get('organizationId')) return c.json({ error: 'not_found' }, 404)
        const { lane, triggerKind, supervisorKind } = c.req.valid('query')
        const preamble = renderPreviewAgentsMd({
          agentDefinition: row,
          organizationId: c.get('organizationId'),
          lane,
          triggerKind,
          supervisorKind,
        }).replace(/\n## Instructions\n[\s\S]*$/, '\n')
        return c.json({ preamble })
      } catch {
        return c.json({ error: 'not_found' }, 404)
      }
    },
  )
  .patch(
    '/definitions/:id',
    zValidator('json', updateBody, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
      }
    }),
    async (c) => {
      const data = c.req.valid('json')
      try {
        const existing = await getById(c.req.param('id'))
        if (existing.organizationId !== c.get('organizationId')) return c.json({ error: 'not_found' }, 404)
        const row = await updateAgent(c.req.param('id'), data)
        return c.json(row)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return c.json({ error: msg }, 404)
      }
    },
  )
  .delete('/definitions/:id', async (c) => {
    try {
      const existing = await getById(c.req.param('id'))
      if (existing.organizationId !== c.get('organizationId')) return c.json({ error: 'not_found' }, 404)
    } catch {
      return c.json({ error: 'not_found' }, 404)
    }
    await removeAgent(c.req.param('id'))
    return c.json({ ok: true })
  })

export default app
