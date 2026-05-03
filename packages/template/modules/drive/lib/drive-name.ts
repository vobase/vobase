/**
 * Pure name-derivation helper for drive uploads.
 *
 * Extractable mimes (anything in `EXTRACTABLE_MIMES`) get rewritten to
 * `<stem>.md` for the agent-facing display path; binary mimes keep their
 * original extension. The `nameStem` is stable across re-extraction so the
 * row's `path` can be recomputed deterministically when a re-extract flips
 * the mime classification.
 */

import { EXTRACTABLE_MIMES } from '../constants'

export interface DeriveDriveNameInput {
  originalName: string
  mimeType: string
}

export interface DeriveDriveNameResult {
  /** Basename without extension; stable across re-extraction. */
  nameStem: string
  /** Display name (`<stem>.md` for extractable, `<stem>.<ext>` for binary). */
  displayName: string
}

/** Strip path segments and the trailing extension from a filename. */
function stripExt(name: string): { stem: string; ext: string } {
  const base = name.split('/').pop() ?? name
  const lastDot = base.lastIndexOf('.')
  if (lastDot <= 0) return { stem: base, ext: '' }
  return { stem: base.slice(0, lastDot), ext: base.slice(lastDot + 1) }
}

/**
 * Derive `nameStem` + `displayName` for an upload.
 *
 * - Extractable mime → `<stem>.md` (agent reads markdown).
 * - Binary mime → `<stem>.<originalExt>` (preserves ext for affordance).
 * - Missing original ext on a binary → bare stem.
 */
export function deriveDriveName(input: DeriveDriveNameInput): DeriveDriveNameResult {
  const { stem, ext } = stripExt(input.originalName)
  const safeStem = stem.length > 0 ? stem : 'file'
  if (EXTRACTABLE_MIMES.has(input.mimeType)) {
    return { nameStem: safeStem, displayName: `${safeStem}.md` }
  }
  const displayName = ext.length > 0 ? `${safeStem}.${ext}` : safeStem
  return { nameStem: safeStem, displayName }
}
