/**
 * Staff-memory change materializer — `team.staff_memory` resource type.
 *
 * Writes the `agents.agent_staff_memory.memory` blob for a given (agentId, staffId)
 * pair. The resourceId convention is `${agentId}:${staffId}` (single colon).
 *
 * Bypasses all service singletons; reads and writes happen on the proposal/decide
 * transaction handle so the mutation is atomic with the change_history row.
 */

import { agentStaffMemory } from '@modules/agents/schema'
import { assertMarkdownPatch, type MaterializeResult, type Materializer } from '@modules/changes/service/proposals'
import { validation } from '@vobase/core'
import { and, eq } from 'drizzle-orm'

/** Stable (resourceModule, resourceType) pair shared by registration and the remember tool. */
export const STAFF_MEMORY_RESOURCE = { module: 'team', type: 'staff_memory' } as const

/**
 * Materializer for `team.staff_memory` proposals.
 *
 * `proposal.resourceId` must be `${agentId}:${staffId}`. Accepts only
 * `markdown_patch` payloads; `field_set` is rejected with a clear validation error.
 */
export const staffMemoryChangeMaterializer: Materializer = async (proposal, tx) => {
  const patch = assertMarkdownPatch(proposal.payload)

  const resourceId = proposal.resourceId
  const colonIdx = resourceId.indexOf(':')
  if (colonIdx <= 0 || colonIdx === resourceId.length - 1) {
    throw validation(
      { resourceId },
      `team/staff_memory: resourceId must be '<agentId>:<staffId>' (got '${resourceId}')`,
    )
  }
  const agentId = resourceId.slice(0, colonIdx)
  const staffId = resourceId.slice(colonIdx + 1)

  const rows = (await tx
    .select({ memory: agentStaffMemory.memory })
    .from(agentStaffMemory)
    .where(
      and(
        eq(agentStaffMemory.organizationId, proposal.organizationId),
        eq(agentStaffMemory.agentId, agentId),
        eq(agentStaffMemory.staffId, staffId),
      ),
    )
    .limit(1)) as Array<{ memory: string }>

  const before = rows[0]?.memory ?? ''
  const after = patch.mode === 'append' && before ? `${before}\n${patch.body}` : patch.body

  if (rows.length > 0) {
    await tx
      .update(agentStaffMemory)
      .set({ memory: after, updatedAt: new Date() })
      .where(
        and(
          eq(agentStaffMemory.organizationId, proposal.organizationId),
          eq(agentStaffMemory.agentId, agentId),
          eq(agentStaffMemory.staffId, staffId),
        ),
      )
  } else {
    await tx
      .insert(agentStaffMemory)
      .values({
        organizationId: proposal.organizationId,
        agentId,
        staffId,
        memory: after,
      })
      .returning()
  }

  return { resultId: resourceId, before, after } satisfies MaterializeResult
}
