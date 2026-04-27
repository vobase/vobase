/**
 * Drive change materializer — patches the targeted Drive doc by path.
 *
 * Phase 2 stub: the proposal's `resourceId` carries the scope-relative path
 * (e.g. '/BUSINESS.md'); approval records the patch in `change_history` but
 * the actual file write into the drive store is deferred until the drive
 * service grows a tx-aware writePath. The proposal status reflects approval
 * for staff-visible audit; physical write lands in a follow-up.
 */

import { assertMarkdownPatch, type MaterializeResult, type Materializer } from '@modules/changes/service/proposals'
import { validation } from '@vobase/core'

export const DRIVE_DOC_RESOURCE = { module: 'drive', type: 'doc' } as const

export const driveDocMaterializer: Materializer = (proposal, _tx) => {
  const path = proposal.resourceId
  if (!path?.startsWith('/')) {
    throw validation({ resourceId: proposal.resourceId }, `drive/changes: resourceId must be a scope-relative path`)
  }
  const body = assertMarkdownPatch(proposal.payload).body
  return Promise.resolve({
    resultId: `drive:${path}`,
    before: null,
    after: { path, body },
  } satisfies MaterializeResult)
}
