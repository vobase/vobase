/**
 * Staff-signal detection.
 *
 * Pure function that scans a wake's event stream for the four staff-signal
 * shapes the learningProposalObserver cares about:
 *
 *   1. `supervisor` wake trigger        — staff kicked the agent awake via
 *                                          an `@staff` mention that routed through
 *                                          `ContactsService.resolveStaffByExternal`.
 *   2. `approval_resumed` + rejected     — staff denied a pending tool call, with
 *                                          optional note on the trigger payload.
 *   3. `internal_note_added` w/ staff    — during-wake note from a human operator.
 *   4. `manual` reassignment-with-note   — staff re-routed the conversation and
 *                                          left a prose reason (reason starts
 *                                          with `reassign`, case-insensitive).
 *
 * Returning an array means one wake may fire multiple proposals — e.g. a
 * supervisor wake that also produces a staff note yields TWO signals, and the
 * observer feeds both into `learn.propose`.
 *
 */

import type { InternalNoteAuthorType } from '@modules/inbox/schema'
import type { AgentEvent } from '@server/contracts/event'
import type { LearningScope } from '../schema'

export type StaffSignalKind = 'supervisor' | 'approval_rejected' | 'internal_note' | 'reassignment_note'

export interface StaffSignal {
  kind: StaffSignalKind
  /** Stable reference (noteId, approvalId, authorUserId) — used for idempotency + LLM prompt anchoring. */
  ref: string
  /** ISO timestamp the signal was produced. */
  ts: string
  /** Optional actor user id when the signal carries one. */
  actorUserId?: string
  /** Short prose preview — note body, rejection reason, reassignment reason. */
  notePreview?: string
  /** Scope hint for the proposer prompt (drives `learn.propose` output routing). */
  scopeHint?: LearningScope
}

/**
 * Scan a wake's event stream and return the staff signals worth teaching the agent.
 *
 * Pure: no ports, no IO, no async — feeds directly into `llmCall('learn.propose', …)`.
 */
export function detectStaffSignals(wakeEvents: readonly AgentEvent[]): StaffSignal[] {
  const signals: StaffSignal[] = []

  for (const event of wakeEvents) {
    if (event.type === 'agent_start') {
      const payload = event.triggerPayload
      if (payload.trigger === 'supervisor') {
        signals.push({
          kind: 'supervisor',
          ref: payload.noteId,
          ts: event.ts.toISOString(),
          actorUserId: payload.authorUserId,
          scopeHint: 'contact',
        })
      } else if (payload.trigger === 'approval_resumed' && payload.decision === 'rejected') {
        signals.push({
          kind: 'approval_rejected',
          ref: payload.approvalId,
          ts: event.ts.toISOString(),
          notePreview: payload.note,
          scopeHint: 'agent_skill',
        })
      } else if (payload.trigger === 'manual' && isReassignReason(payload.reason)) {
        signals.push({
          kind: 'reassignment_note',
          ref: payload.actorUserId,
          ts: event.ts.toISOString(),
          actorUserId: payload.actorUserId,
          notePreview: payload.reason,
          scopeHint: 'contact',
        })
      }
      continue
    }

    if (event.type === 'internal_note_added' && isStaffAuthor(event.authorType)) {
      signals.push({
        kind: 'internal_note',
        ref: event.noteId,
        ts: event.ts.toISOString(),
        scopeHint: 'agent_memory',
      })
    }
  }

  return signals
}

function isStaffAuthor(authorType: InternalNoteAuthorType): boolean {
  return authorType === 'staff'
}

function isReassignReason(reason: string): boolean {
  return /^reassign/i.test(reason.trim())
}
