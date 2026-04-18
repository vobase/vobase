/**
 * Learning proposals — insert `agents.learning_proposals` rows for drive/skill scope.
 * Spec §13 (learning flow), §12.1 (learningProposalObserver wiring).
 *
 * Scope routing (spec §2.9):
 *   contact / agent_memory → auto-written immediately (no staff approval needed)
 *   agent_skill / drive_doc → status='pending', waits for staff approval
 *
 * Phase 2: only the insert path. The auto-write and staff-signal detection are
 * Phase 3 (full learningProposalObserver end-to-end per plan §5).
 */

import { nanoid } from 'nanoid'

let _db: unknown = null

export function setDb(db: unknown): void {
  _db = db
}

function requireDb() {
  if (!_db) throw new Error('agents/learning-proposals: db not initialised — call setDb() in module init')
  return _db as {
    insert: (t: unknown) => { values: (v: unknown) => { returning: () => Promise<Array<{ id: string }>> } }
    update: (t: unknown) => { set: (v: unknown) => { where: (c: unknown) => Promise<void> } }
  }
}

export type ProposalScope = 'contact' | 'agent_memory' | 'agent_skill' | 'drive_doc'
export type ProposalAction = 'upsert' | 'create' | 'patch'
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'superseded' | 'auto_written'

export interface InsertProposalInput {
  tenantId: string
  conversationId: string
  scope: ProposalScope
  action: ProposalAction
  /** Scope-relative target path or identifier (e.g. '/pricing.md', 'skill-name'). */
  target: string
  body?: string
  rationale?: string
  confidence?: number
  /** Pre-set status — default 'pending'. Auto-writes pass 'auto_written'. */
  status?: ProposalStatus
}

export interface ProposalRow {
  id: string
  tenantId: string
  conversationId: string
  scope: ProposalScope
  action: ProposalAction
  target: string
  body: string | null
  rationale: string | null
  confidence: number | null
  status: ProposalStatus
}

export async function insertProposal(input: InsertProposalInput): Promise<{ id: string }> {
  const { learningProposals } = await import('@modules/agents/schema')
  const db = requireDb()
  const id = nanoid(10)
  const status: ProposalStatus = input.status ?? (needsApproval(input.scope) ? 'pending' : 'auto_written')

  await db
    .insert(learningProposals)
    .values({
      id,
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      scope: input.scope,
      action: input.action,
      target: input.target,
      body: input.body ?? null,
      rationale: input.rationale ?? null,
      confidence: input.confidence ?? null,
      status,
    })
    .returning()

  return { id }
}

export async function decideProposal(
  id: string,
  decision: 'approved' | 'rejected',
  decidedByUserId: string,
  note?: string,
): Promise<void> {
  const { learningProposals } = await import('@modules/agents/schema')
  const { eq } = await import('drizzle-orm')
  const db = requireDb()

  await db
    .update(learningProposals)
    .set({
      status: decision,
      decidedByUserId,
      decidedAt: new Date(),
      decidedNote: note ?? null,
    })
    .where(eq(learningProposals.id, id))
}

function needsApproval(scope: ProposalScope): boolean {
  return scope === 'agent_skill' || scope === 'drive_doc'
}
