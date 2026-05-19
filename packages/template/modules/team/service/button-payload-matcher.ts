/**
 * WhatsApp interactive button payload matcher (US-009 / Slice B.4 stub).
 *
 * When Slice C (US-011 / US-012) ships kind-specific Meta templates, the
 * `vobase_decision_required_v2` button taps arrive
 * as `interactive.button_reply` payloads with `id = 'approve:<refId>'` or
 * `id = 'deny:<refId>'`. This matcher recognises that shape so the inbound
 * handler can short-circuit the free-text regex path.
 *
 * Kind resolution: `pending_approvals.id` and `change_proposals.id` both use
 * the plain 8-char `nanoidPrimaryKey()` alphabet — there is NO discriminating
 * prefix on the id alone. This matcher therefore returns `{decision, referenceId}`
 * only; the caller (inbound handler) resolves kind by trying
 * `pendingApprovals.get(refId)` first and falling back to
 * `proposals.get(refId)`. When Slice C lands a `vobase_*` button id can be
 * extended to encode the kind (e.g. `approve:apr:<refId>`) and the matcher
 * upgraded to return `kind` directly without a DB lookup.
 */

const BUTTON_ID_REGEX = /^(approve|deny):([\w-]+)$/

export interface ButtonReplyPayload {
  type: 'button_reply'
  id: string
  title?: string
}

export interface ButtonMatch {
  decision: 'approve' | 'deny'
  referenceId: string
}

function isButtonReplyPayload(p: unknown): p is ButtonReplyPayload {
  if (typeof p !== 'object' || p === null) return false
  const rec = p as Record<string, unknown>
  return rec.type === 'button_reply' && typeof rec.id === 'string'
}

export function matchButtonPayload(payload: ButtonReplyPayload | unknown): ButtonMatch | null {
  if (!isButtonReplyPayload(payload)) return null
  const m = payload.id.match(BUTTON_ID_REGEX)
  if (!m) return null
  const decision = m[1] as 'approve' | 'deny'
  const referenceId = m[2]
  if (!referenceId) return null
  return { decision, referenceId }
}
