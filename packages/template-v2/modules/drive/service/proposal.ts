/**
 * Drive proposal service — `vobase drive propose` inserts a `learning_proposals` row
 * for organization-drive documents that the agent cannot write directly.
 *
 * Scope routing: organization-drive writes require staff approval (scope='drive_doc',
 * status='pending'). Contact-drive writes are free and go through workspaceSyncObserver.
 *
 * `decide()` is called by the staff approval handler (modules/drive/handlers/proposal.ts).
 * On approval, it writes the drive file via the drive service (Phase 2 stub — the actual
 * drive.files.create call is deferred until a real `ScopedDb` lands; the proposal row is
 * updated to 'approved' and the write ID is stored for idempotency).
 */

import { decideProposal, insertProposal } from '@modules/agents/service/learning-proposals'

let _tenantId = ''
export function setTenantId(id: string): void {
  _tenantId = id
}

export interface DriveProposalInput {
  conversationId: string
  /** Scope-relative path under organization drive (e.g. '/pricing.md'). */
  path: string
  body: string
  rationale?: string
  confidence?: number
}

export interface DriveProposalResult {
  proposalId: string
  status: 'pending'
}

/**
 * Insert a learning_proposals row for a organization-drive document change.
 * Status is always 'pending' — staff must approve before the file is written.
 */
export async function propose(input: DriveProposalInput): Promise<DriveProposalResult> {
  if (!_tenantId) throw new Error('drive/proposal: organizationId not set — call setTenantId() in module init')

  const { id: proposalId } = await insertProposal({
    organizationId: _tenantId,
    conversationId: input.conversationId,
    scope: 'drive_doc',
    action: 'upsert',
    target: input.path,
    body: input.body,
    rationale: input.rationale,
    confidence: input.confidence,
    status: 'pending',
  })

  return { proposalId, status: 'pending' }
}

/**
 * Staff decision on a drive proposal.
 * On approval: marks approved_write_id = proposalId (actual file write is Phase 3).
 */
export async function decideDriveProposal(
  proposalId: string,
  decision: 'approved' | 'rejected',
  decidedByUserId: string,
  note?: string,
): Promise<void> {
  await decideProposal(proposalId, decision, decidedByUserId, note)
}
