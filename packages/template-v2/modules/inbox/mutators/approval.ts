/**
 * approvalMutator — blocks send_card (and send_file, book_slot) when the agent's
 * approval flags require staff sign-off.
 *
 * Hooks into `before()` which fires at the `tool_execution_start` boundary (C1 — do NOT
 * add a new `tool_call_start` event variant; the existing event covers this seam).
 *
 * before() flow:
 *   1. Check if step.toolName matches an approval-gated tool.
 *   2. Look up the agent via the conversation's assignee field.
 *   3. If agent.{tool}_approval_required: insert pending_approvals row using ctx.db.
 *   4. Call ctx.persistEvent({ type: 'approval_requested', ... }).
 *   5. Return { action: 'block', reason: `pending_approval:<id>` }.
 *
 * Spec §12.1 mutator #2. See also spec §8.3 approval sequence diagram.
 */

import type { AgentMutator, AgentStep, MutatorContext, MutatorDecision } from '@server/contracts/mutator'

/** Tool names → agent flag mapping. */
const APPROVAL_TOOL_MAP: Record<string, 'cardApprovalRequired' | 'fileApprovalRequired' | 'bookSlotApprovalRequired'> =
  {
    send_card: 'cardApprovalRequired',
    send_file: 'fileApprovalRequired',
    book_slot: 'bookSlotApprovalRequired',
  }

export const approvalMutator: AgentMutator = {
  id: 'inbox:approval',

  async before(step: AgentStep, ctx: MutatorContext): Promise<MutatorDecision | undefined> {
    const approvalFlag = APPROVAL_TOOL_MAP[step.toolName]
    if (!approvalFlag) return undefined

    const { eq } = await import('drizzle-orm')
    const { conversations, pendingApprovals } = await import('@modules/inbox/schema')
    const { agentDefinitions } = await import('@modules/agents/schema')

    type SelectDb = {
      select: () => {
        from: (t: unknown) => {
          where: (c: unknown) => {
            limit: (n: number) => Promise<Array<Record<string, unknown>>>
          }
        }
      }
    }
    type InsertDb = {
      insert: (t: unknown) => {
        values: (v: unknown) => { returning: () => Promise<Array<{ id: string }>> }
      }
    }

    const db = ctx.db as SelectDb & InsertDb

    // Look up the conversation to get the assignee (agent id)
    const convRows = await db.select().from(conversations).where(eq(conversations.id, ctx.conversationId)).limit(1)

    const conv = convRows[0] as { assignee: string } | undefined
    if (!conv) return undefined

    const agentId = conv.assignee.startsWith('agent:') ? conv.assignee.slice(6) : null
    if (!agentId) return undefined

    // Look up the agent definition
    const agentRows = await db.select().from(agentDefinitions).where(eq(agentDefinitions.id, agentId)).limit(1)

    const agent = agentRows[0] as Record<string, unknown> | undefined
    if (!agent) return undefined

    const requiresApproval = agent[approvalFlag] as boolean
    if (!requiresApproval) return undefined

    // Insert pending_approvals row directly via ctx.db (avoids service db-injection issue in tests)
    const { nanoid } = await import('nanoid')
    const approvalId = nanoid(8)

    await db
      .insert(pendingApprovals)
      .values({
        id: approvalId,
        tenantId: ctx.tenantId,
        conversationId: ctx.conversationId,
        conversationEventId: null,
        toolName: step.toolName,
        toolArgs: step.args as Record<string, unknown>,
        agentSnapshot: { wakeId: ctx.wakeId, step } as Record<string, unknown>,
        wakeId: ctx.wakeId,
        status: 'pending',
      })
      .returning()

    // Emit approval_requested event through the journal chokepoint
    await ctx.persistEvent({
      type: 'approval_requested',
      approvalId,
      toolName: step.toolName,
      ts: new Date(),
      wakeId: ctx.wakeId,
      conversationId: ctx.conversationId,
      tenantId: ctx.tenantId,
      turnIndex: 0,
    })

    return { action: 'block', reason: `pending_approval:${approvalId}` }
  },
}
