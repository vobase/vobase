/**
 * Agent change materializers — `learned_skill` (requires approval) and
 * `agent_memory` (auto-write). Both bypass the agents service singletons
 * because writes must happen on the proposal/decide transaction handle.
 */

import {
  assertMarkdownPatch,
  type MaterializeResult,
  type Materializer,
  type TxLike,
} from '@modules/changes/service/proposals'
import { conversations } from '@modules/messaging/schema'
import { conflict, conversationEvents, validation } from '@vobase/core'
import { and, desc, eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'

import { agentDefinitions, learnedSkills } from '../schema'

/** Stable (resourceModule, resourceType) pairs shared by registration, materializers, and CLI verbs. */
export const AGENT_SKILL_RESOURCE = { module: 'agents', type: 'learned_skill' } as const
export const AGENT_MEMORY_RESOURCE = { module: 'agents', type: 'agent_memory' } as const

/**
 * Insert a `learned_skills` row tied to the originating proposal. Agent id is
 * extracted from the wake's `agent_start` event, falling back to the conversation
 * assignee when the event is unavailable. Skill rows with `agentId = null` float
 * at organization scope.
 */
export const agentSkillMaterializer: Materializer = async (proposal, tx) => {
  const body = assertMarkdownPatch(proposal.payload).body
  const skillName = proposal.resourceId
  if (!skillName) {
    throw validation({ resourceId: proposal.resourceId }, 'agent_skill: resourceId (skill name) required')
  }
  const agentId = proposal.conversationId ? await resolveAgentId(tx, proposal.conversationId) : null
  const skillId = nanoid(10)
  await tx
    .insert(learnedSkills)
    .values({
      id: skillId,
      organizationId: proposal.organizationId,
      agentId,
      name: skillName,
      description: proposal.rationale ?? skillName,
      body,
      parentProposalId: proposal.id,
    })
    .returning()

  return {
    resultId: skillId,
    before: null,
    after: { id: skillId, agentId, name: skillName, body, parentProposalId: proposal.id },
  } satisfies MaterializeResult
}

/**
 * Patch `agent_definitions.workingMemory`. `resourceId` IS the agent id;
 * markdown_patch with `mode='append'` concatenates, `mode='replace'` overwrites.
 */
export const agentMemoryMaterializer: Materializer = async (proposal, tx) => {
  const agentId = proposal.resourceId
  if (!agentId) {
    throw validation({ resourceId: proposal.resourceId }, 'agent_memory: resourceId (agentId) required')
  }
  const patch = assertMarkdownPatch(proposal.payload)
  const rows = (await tx
    .select({ workingMemory: agentDefinitions.workingMemory })
    .from(agentDefinitions)
    .where(eq(agentDefinitions.id, agentId))
    .limit(1)) as Array<{ workingMemory: string }>
  const before = rows[0]?.workingMemory ?? null
  if (before === null) throw conflict(`agent_memory: agent not found: ${agentId}`)
  const after = patch.mode === 'append' && before ? `${before}\n${patch.body}` : patch.body
  await tx.update(agentDefinitions).set({ workingMemory: after }).where(eq(agentDefinitions.id, agentId))
  return { resultId: agentId, before, after } satisfies MaterializeResult
}

// ─── Helpers ────────────────────────────────────────────────────────────────

interface AgentStartRow {
  payload: unknown
  toolCalls: unknown
}

async function resolveAgentId(tx: TxLike, conversationId: string): Promise<string | null> {
  const startRows = (await tx
    .select({ payload: conversationEvents.payload, toolCalls: conversationEvents.toolCalls })
    .from(conversationEvents)
    .where(and(eq(conversationEvents.conversationId, conversationId), eq(conversationEvents.type, 'agent_start')))
    .orderBy(desc(conversationEvents.ts))
    .limit(1)) as unknown as AgentStartRow[]
  const fromStart = extractAgentIdFromStart(startRows[0])
  if (fromStart) return fromStart
  const convRows = (await tx
    .select({ assignee: conversations.assignee })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)) as Array<{ assignee: string }>
  const assignee = convRows[0]?.assignee ?? ''
  return assignee.startsWith('agent:') ? assignee.slice('agent:'.length) : null
}

function extractAgentIdFromStart(row: AgentStartRow | undefined): string | null {
  if (!row) return null
  const payload = (row.payload ?? row.toolCalls) as Record<string, unknown> | null
  if (!payload) return null
  const agentId = payload.agentId
  return typeof agentId === 'string' ? agentId : null
}

// ─── learned_skills query (moved from learning-proposals.ts) ────────────────

export interface LearnedSkillRow {
  id: string
  organizationId: string
  agentId: string | null
  name: string
  description: string
  body: string
  parentProposalId: string | null
  updatedAt: Date
}

interface DrizzleHandle {
  select: (cols?: unknown) => {
    from: (t: unknown) => {
      where: (c: unknown) => {
        orderBy: (col: unknown) => Promise<Array<Record<string, unknown>>>
      }
    }
  }
}

export interface AgentSkillsService {
  /**
   * Skills bound to one agent — both rows with `agent_id = <agentId>` AND
   * org-scoped rows with `agent_id = NULL` (those float at org scope, e.g.
   * approvals where the originating conversation had no agent_start event).
   */
  listSkillsForAgent(input: { organizationId: string; agentId: string }): Promise<LearnedSkillRow[]>
}

export function createAgentSkillsService(deps: { db: unknown }): AgentSkillsService {
  const db = deps.db as DrizzleHandle
  return {
    async listSkillsForAgent({ organizationId, agentId }) {
      const rows = (await db
        .select({
          id: learnedSkills.id,
          organizationId: learnedSkills.organizationId,
          agentId: learnedSkills.agentId,
          name: learnedSkills.name,
          description: learnedSkills.description,
          body: learnedSkills.body,
          parentProposalId: learnedSkills.parentProposalId,
          updatedAt: learnedSkills.updatedAt,
        })
        .from(learnedSkills)
        .where(
          and(
            eq(learnedSkills.organizationId, organizationId),
            sql`(${learnedSkills.agentId} = ${agentId} OR ${learnedSkills.agentId} IS NULL)`,
          ),
        )
        .orderBy(desc(learnedSkills.updatedAt))) as unknown as LearnedSkillRow[]
      return rows
    },
  }
}

let _service: AgentSkillsService | null = null

export function installAgentSkillsService(svc: AgentSkillsService): void {
  _service = svc
}

function current(): AgentSkillsService {
  if (!_service) {
    throw new Error('agents/skills: service not installed — call installAgentSkillsService() in module init')
  }
  return _service
}

export function listSkillsForAgent(input: { organizationId: string; agentId: string }): Promise<LearnedSkillRow[]> {
  return current().listSkillsForAgent(input)
}
