/**
 * Pending-decision follow-up logic (US-010 / Slice B.5).
 *
 * Pure function over `(now, pending rows)` → list of actions the dispatcher
 * (US-013) must execute. Separating compute from side-effects keeps the rules
 * unit-testable; the dispatcher reads `pending_approvals` + `change_proposals`,
 * joins per-row follow-up attempt counts from `automation_runs`, calls this,
 * and applies actions to `messaging.addNote` / `team.staffPing`.
 *
 * Rules per pending row:
 *   - elapsed < 1h  AND followupAttempt < 6  → `reping`     (attempt = n+1)
 *   - elapsed < 1h  AND followupAttempt ≥ 6  → `cap_reached` (stop pinging)
 *   - elapsed ≥ 1h                            → `timeout_note`
 *     (caller skips emission if an idempotency row for
 *      `(pendingId, 'timeout-note')` already exists — implemented as a
 *      service-level SELECT-then-INSERT inside the dispatcher's tx, or via
 *      a UNIQUE `(event, target_id)` row in `audit_log` once US-013 lands.)
 *
 * The function never reads the clock — tests pass `now` explicitly.
 */

const ONE_HOUR_MS = 60 * 60 * 1000
export const MAX_REPINGS = 6

export interface PendingRow {
  id: string
  kind: 'approval' | 'proposal'
  conversationId: string
  createdAt: Date
  /** Staff user id who must decide — recipient of the re-ping. */
  assigneeStaffUserId: string
  /** Agent that filed the row; FYI for the dispatcher. */
  filedByAgentId: string
  /** How many re-pings have already fired. 0 on first sweep, +1 each `reping`. */
  followupAttempt: number
}

export type FollowupAction =
  | { type: 'timeout_note'; pendingId: string; conversationId: string; bodyText: string }
  | {
      type: 'reping'
      pendingId: string
      kind: 'approval' | 'proposal'
      staffUserId: string
      conversationId: string
      attempt: number
    }
  | { type: 'cap_reached'; pendingId: string }

/**
 * Compute the dispatcher's next action for each pending row.
 *
 * Returns one action per input row (1:1) so the caller can correlate by index
 * or by `pendingId`. Caller is responsible for the idempotency guard on
 * `timeout_note` — see file-level docstring.
 */
export function computeFollowupActions(now: Date, rows: readonly PendingRow[]): FollowupAction[] {
  const actions: FollowupAction[] = []
  for (const row of rows) {
    const elapsed = now.getTime() - row.createdAt.getTime()
    if (elapsed >= ONE_HOUR_MS) {
      actions.push({
        type: 'timeout_note',
        pendingId: row.id,
        conversationId: row.conversationId,
        bodyText: timeoutNoteBody(row),
      })
      continue
    }
    if (row.followupAttempt >= MAX_REPINGS) {
      actions.push({ type: 'cap_reached', pendingId: row.id })
      continue
    }
    actions.push({
      type: 'reping',
      pendingId: row.id,
      kind: row.kind,
      staffUserId: row.assigneeStaffUserId,
      conversationId: row.conversationId,
      attempt: row.followupAttempt + 1,
    })
  }
  return actions
}

function timeoutNoteBody(row: PendingRow): string {
  const label = row.kind === 'approval' ? 'Approval' : 'Proposal'
  return `⏱ ${label} #${row.id} pending 1h+ — no response on WhatsApp`
}
