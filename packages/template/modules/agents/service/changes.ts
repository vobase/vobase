/**
 * Agent change materializers — `learned_skill` (requires approval) and
 * `agent_memory` (auto-write). Both bypass the agents service singletons
 * because writes must happen on the proposal/decide transaction handle.
 */

import {
  assertMarkdownPatch,
  type MaterializeResult,
  type Materializer,
  mergeMarkdownPatch,
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
 * Upsert a `learned_skills` row tied to the originating proposal. Agent id is
 * extracted from the wake's `agent_start` event, falling back to the conversation
 * assignee when the event is unavailable. Skill rows with `agentId = null` float
 * at organization scope.
 *
 * Rewrite semantics: when `(orgId, agentId, name)` already exists, the existing
 * row is updated in place rather than rejected on the unique constraint. The
 * proposal's `mode` decides how the body merges:
 * - `replace` (or default for skills) — overwrite the body
 * - `append` — concatenate the new body onto the existing one
 */
export const agentSkillMaterializer: Materializer = async (proposal, tx) => {
  const patch = assertMarkdownPatch(proposal.payload)
  const skillName = proposal.resourceId
  if (!skillName) {
    throw validation({ resourceId: proposal.resourceId }, 'agent_skill: resourceId (skill name) required')
  }
  const agentId = proposal.conversationId ? await resolveAgentId(tx, proposal.conversationId) : null

  const existingRows = (await tx
    .select({ id: learnedSkills.id, body: learnedSkills.body })
    .from(learnedSkills)
    .where(
      and(
        eq(learnedSkills.organizationId, proposal.organizationId),
        agentId ? eq(learnedSkills.agentId, agentId) : sql`${learnedSkills.agentId} IS NULL`,
        eq(learnedSkills.name, skillName),
      ),
    )
    .limit(1)) as Array<{ id: string; body: string }>
  const existing = existingRows[0]

  if (existing) {
    const nextBody = patch.mode === 'append' ? `${existing.body}\n${patch.body}` : patch.body
    await tx
      .update(learnedSkills)
      .set({
        body: nextBody,
        description: proposal.rationale ?? skillName,
        parentProposalId: proposal.id,
        updatedAt: new Date(),
      })
      .where(eq(learnedSkills.id, existing.id))
    return {
      resultId: existing.id,
      before: { body: existing.body },
      after: { id: existing.id, agentId, name: skillName, body: nextBody, parentProposalId: proposal.id },
    } satisfies MaterializeResult
  }

  const skillId = nanoid(10)
  await tx
    .insert(learnedSkills)
    .values({
      id: skillId,
      organizationId: proposal.organizationId,
      agentId,
      name: skillName,
      description: proposal.rationale ?? skillName,
      body: patch.body,
      parentProposalId: proposal.id,
    })
    .returning()

  return {
    resultId: skillId,
    before: null,
    after: { id: skillId, agentId, name: skillName, body: patch.body, parentProposalId: proposal.id },
  } satisfies MaterializeResult
}

/**
 * Patch `agent_definitions.workingMemory`. `resourceId` IS the agent id;
 * markdown_patch with `mode='append'` concatenates (duplicate-line appends
 * no-op — see `mergeMarkdownPatch`), `mode='replace'` overwrites.
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
  const after = mergeMarkdownPatch(before, patch)
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

export interface UpsertLearnedSkillInput {
  organizationId: string
  agentId: string
  /** Slug-cased name, unique per `(organizationId, agentId)`. */
  name: string
  /** SKILL.md body. */
  body: string
  /** When omitted on update, the existing description is preserved; defaults to '' on insert. */
  description?: string
  /** When omitted on update, existing tags are preserved; defaults to [] on insert. */
  tags?: string[]
}

export interface UpsertLearnedSkillRow {
  id: string
  organizationId: string
  agentId: string | null
  name: string
  description: string
  body: string
  tags: string[]
  version: number
  updatedAt: Date
}

export interface AgentSkillsService {
  /**
   * Skills bound to one agent — both rows with `agent_id = <agentId>` AND
   * org-scoped rows with `agent_id = NULL` (those float at org scope, e.g.
   * approvals where the originating conversation had no agent_start event).
   */
  listSkillsForAgent(input: { organizationId: string; agentId: string }): Promise<LearnedSkillRow[]>
  /**
   * Upsert a learned-skill row keyed on the `uq_learned_skills_name`
   * unique index `(organizationId, agentId, name)`. Increments `version`
   * by one on update; leaves `parentProposalId` / `threatScanReport`
   * untouched (this is the scripted-apply path, not a proposal).
   */
  upsertLearnedSkill(input: UpsertLearnedSkillInput): Promise<UpsertLearnedSkillRow>
  /**
   * Delete the learned-skill row keyed on `(organizationId, agentId, name)`.
   * Returns the number of rows removed (0 when the skill never existed for
   * this agent, 1 on a clean delete). Used by `agents remove-skill` to
   * actually disappear obsolete skills from the agent's `/skills/` mount —
   * the allowlist trim alone leaves learned-row backed skills visible.
   */
  removeLearnedSkill(input: { organizationId: string; agentId: string; name: string }): Promise<{ deleted: number }>
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
    async upsertLearnedSkill(input) {
      const insertValues: Record<string, unknown> = {
        id: nanoid(10),
        organizationId: input.organizationId,
        agentId: input.agentId,
        name: input.name,
        description: input.description ?? '',
        body: input.body,
        tags: input.tags ?? [],
        version: 1,
      }
      const setOnUpdate: Record<string, unknown> = {
        body: input.body,
        version: sql`COALESCE(${learnedSkills.version}, 0) + 1`,
        updatedAt: new Date(),
      }
      if (input.description !== undefined) setOnUpdate.description = input.description
      if (input.tags !== undefined) setOnUpdate.tags = input.tags

      const handle = deps.db as {
        insert: (t: unknown) => {
          values: (v: Record<string, unknown>) => {
            onConflictDoUpdate: (cfg: { target: unknown; set: Record<string, unknown> }) => {
              returning: () => Promise<Array<Record<string, unknown>>>
            }
          }
        }
      }
      const rows = (await handle
        .insert(learnedSkills)
        .values(insertValues)
        .onConflictDoUpdate({
          target: [learnedSkills.organizationId, learnedSkills.agentId, learnedSkills.name],
          set: setOnUpdate,
        })
        .returning()) as unknown as Array<{
        id: string
        organizationId: string
        agentId: string | null
        name: string
        description: string
        body: string
        tags: string[] | null
        version: number | null
        updatedAt: Date
      }>
      const row = rows[0]
      if (!row) throw new Error(`agents/upsertLearnedSkill: insert returned no rows for ${input.name}`)
      return {
        id: row.id,
        organizationId: row.organizationId,
        agentId: row.agentId,
        name: row.name,
        description: row.description,
        body: row.body,
        tags: row.tags ?? [],
        version: row.version ?? 1,
        updatedAt: row.updatedAt,
      }
    },
    async removeLearnedSkill({ organizationId, agentId, name }) {
      const handle = deps.db as {
        delete: (t: unknown) => {
          where: (clause: unknown) => { returning: () => Promise<Array<{ id: string }>> }
        }
      }
      const rows = await handle
        .delete(learnedSkills)
        .where(
          and(
            eq(learnedSkills.organizationId, organizationId),
            eq(learnedSkills.agentId, agentId),
            eq(learnedSkills.name, name),
          ),
        )
        .returning()
      return { deleted: rows.length }
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

export function upsertLearnedSkill(input: UpsertLearnedSkillInput): Promise<UpsertLearnedSkillRow> {
  return current().upsertLearnedSkill(input)
}

export function removeLearnedSkill(input: {
  organizationId: string
  agentId: string
  name: string
}): Promise<{ deleted: number }> {
  return current().removeLearnedSkill(input)
}
