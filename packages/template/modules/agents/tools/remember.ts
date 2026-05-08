/**
 * `remember` — commit a lesson to durable memory via the change-proposals
 * pipeline. Sensitivity-routed: high-confidence + low-sensitivity writes
 * immediately (auto_written); lower combinations queue for staff review (pending);
 * below-floor confidence is dropped.
 *
 * Optionally marks a `learning_candidates` row as consumed when `candidateId`
 * is supplied.
 */

import { markConsumed } from '@modules/agents/service/learning-candidates'
import { insertProposal, listMaterializerRegistrations } from '@modules/changes/service/proposals'
import { type Static, Type } from '@sinclair/typebox'
import { defineAgentTool } from '@vobase/core'

// ─── Scope helpers ────────────────────────────────────────────────────────────

/** Build the set of valid scope strings from the live materializer registry. */
function listScopes(): readonly string[] {
  return listMaterializerRegistrations().map((r) => `${r.resourceModule}.${r.resourceType}`)
}

// ─── Schema ───────────────────────────────────────────────────────────────────

export const RememberInputSchema = Type.Object({
  candidateId: Type.Optional(Type.String({ description: 'Optional learning_candidates.id this remember consumes.' })),
  scope: Type.String({
    description:
      'Target resource (format: "module.type", e.g. "agents.agent_memory", "contacts.contact_memory", "team.staff_memory"). Pick from listMaterializerRegistrations().',
  }),
  resourceId: Type.Optional(
    Type.String({
      description: 'Resource id. Required for all scopes except "agents.agent_memory" (defaults to the wake agent id).',
    }),
  ),
  body: Type.String({ minLength: 1, description: 'Markdown body to append/replace into the memory blob.' }),
  mode: Type.Union([Type.Literal('append'), Type.Literal('replace')], {
    description: 'Whether to append to or replace the existing memory blob.',
    default: 'append',
  }),
  confidence: Type.Number({
    minimum: 0,
    maximum: 1,
    description: "Agent's confidence this lesson is true. Routes auto/pending/drop.",
  }),
  rationale: Type.String({ minLength: 1, description: 'Why this is worth remembering.' }),
  expectedOutcome: Type.Optional(Type.String()),
})

export type RememberInput = Static<typeof RememberInputSchema>

// ─── Tool ─────────────────────────────────────────────────────────────────────

export const rememberTool = defineAgentTool({
  name: 'remember',
  description:
    'Commit a lesson to durable memory. Routes through change-proposals: auto-write or queue for review based on confidence × resource sensitivity. Use after consuming a learning candidate, or any time you want to make a fact stick.',
  schema: RememberInputSchema,
  errorCode: 'REMEMBER_ERROR',
  audience: 'internal',
  lane: 'both',
  prompt: [
    'Use to commit lasting facts: agent rules ("always do X"), per-customer facts (preferences, history), per-staff facts (tone, expertise).',
    'Pick `scope` from the AGENTS.md "Memory & sensitivity" table.',
    '**`resourceId` is required for every scope except `agents.agent_memory`** (which defaults to your own agent id):',
    '  - `contacts.contact_memory` → resourceId = the contact id you can read from `/contacts/<id>/MEMORY.md` or `messaging.conversations.contact_id`.',
    '  - `team.staff_memory` → resourceId = `<your-agent-id>:<staffId>` (single colon). The staff id is the `usr...` id you see in `/staff/<id>/MEMORY.md`.',
    '  - `agents.learned_skill` → resourceId = a kebab-case skill name (e.g. `redeem-promo`). New skill → pick a name; updating an existing skill → reuse the exact name.',
    'Set `confidence` honestly — high confidence + low-sensitivity scope auto-writes; lower combinations queue for staff review.',
    'When acting on a `learning_candidate` from side-load, pass its id as `candidateId` so it gets marked consumed.',
  ].join('\n'),
  async run(args, ctx) {
    const scopes = listScopes()
    if (!scopes.includes(args.scope)) {
      return {
        ok: false as const,
        error: `Unknown scope "${args.scope}". Valid scopes: ${scopes.join(', ')}`,
        errorCode: 'unknown_scope' as const,
      }
    }

    const [resourceModule, resourceType] = args.scope.split('.', 2) as [string, string]

    const resourceId = resolveResourceId(resourceModule, resourceType, args.resourceId, ctx.agentId)
    if (!resourceId) {
      return {
        ok: false as const,
        error: `Missing resourceId for scope "${args.scope}" and could not derive from wake context.`,
        errorCode: 'missing_resource_id' as const,
      }
    }

    const result = await insertProposal({
      organizationId: ctx.organizationId,
      resourceModule,
      resourceType,
      resourceId,
      payload: { kind: 'markdown_patch', mode: args.mode ?? 'append', field: 'memory', body: args.body },
      changedBy: `agent:${ctx.agentId}`,
      changedByKind: 'agent',
      confidence: args.confidence,
      rationale: args.rationale,
      expectedOutcome: args.expectedOutcome,
      conversationId: ctx.conversationId ?? null,
    })

    if (result.status === 'dropped') {
      return {
        ok: false as const,
        error: `Trivial — dropped at confidence ${result.confidence}.`,
        errorCode: 'trivial_proposal' as const,
      }
    }

    if (args.candidateId) {
      try {
        await markConsumed(args.candidateId, result.id)
      } catch (err) {
        console.warn('[remember] markConsumed failed:', err)
        // non-fatal — proposal already inserted
      }
    }

    return { ok: true as const, status: result.status, proposalId: result.id }
  },
})

// ─── Resource id resolution ───────────────────────────────────────────────────

/**
 * Derive the proposal `resourceId` from available context.
 *
 * - `agents.agent_memory`: resourceId IS the agentId — derivable from ctx.
 * - All other scopes (contacts.contact_memory, team.staff_memory, etc.):
 *   caller MUST supply `args.resourceId` because ToolContext does not carry
 *   contactId or staffId at the tool-dispatch level.
 */
function resolveResourceId(
  resourceModule: string,
  resourceType: string,
  argResourceId: string | undefined,
  agentId: string,
): string | null {
  if (argResourceId) return argResourceId
  if (resourceModule === 'agents' && resourceType === 'agent_memory') return agentId
  return null
}
