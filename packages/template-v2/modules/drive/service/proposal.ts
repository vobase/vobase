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
 *
 * Factory-DI service. `createProposalService({ organizationId })` returns the
 * bound API; `installProposalService(svc)` wires the module-scoped handle used by the
 * free-function wrappers below.
 */

import { decideProposal, insertProposal } from '@modules/agents/service/learning-proposals'

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

export interface ProposalService {
  propose(input: DriveProposalInput): Promise<DriveProposalResult>
  decideDriveProposal(
    proposalId: string,
    decision: 'approved' | 'rejected',
    decidedByUserId: string,
    note?: string,
  ): Promise<void>
}

export interface ProposalServiceDeps {
  organizationId: string
}

export function createProposalService(deps: ProposalServiceDeps): ProposalService {
  const organizationId = deps.organizationId

  async function propose(input: DriveProposalInput): Promise<DriveProposalResult> {
    if (!organizationId) {
      throw new Error(
        'drive/proposal: organizationId not set — construct createProposalService with a wake organizationId',
      )
    }

    const { id: proposalId } = await insertProposal({
      organizationId,
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

  async function decideDriveProposal(
    proposalId: string,
    decision: 'approved' | 'rejected',
    decidedByUserId: string,
    note?: string,
  ): Promise<void> {
    await decideProposal(proposalId, decision, decidedByUserId, note)
  }

  return { propose, decideDriveProposal }
}

let _currentProposalService: ProposalService | null = null

export function installProposalService(svc: ProposalService): void {
  _currentProposalService = svc
}

export function __resetProposalServiceForTests(): void {
  _currentProposalService = null
}

function current(): ProposalService {
  if (!_currentProposalService) {
    throw new Error('drive/proposal: service not installed — call installProposalService() in module init')
  }
  return _currentProposalService
}

export async function propose(input: DriveProposalInput): Promise<DriveProposalResult> {
  return current().propose(input)
}

export async function decideDriveProposal(
  proposalId: string,
  decision: 'approved' | 'rejected',
  decidedByUserId: string,
  note?: string,
): Promise<void> {
  return current().decideDriveProposal(proposalId, decision, decidedByUserId, note)
}
