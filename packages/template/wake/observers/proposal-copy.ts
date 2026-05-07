/**
 * Builds human-readable `rationale` + `expectedOutcome` copy for change
 * proposals coming out of the wake observers. The audit inbox is read by
 * non-technical SME staff, so the prose has to name the subject, list the
 * actual edits, and stay clear of harness jargon ("frontmatter", "field_set",
 * "row", "supervisor wake").
 *
 * Surface today:
 *   - `buildStaffSignalCopy` — `agent_memory` proposals from
 *                              `learning-proposals`. Names the staff
 *                              author and quotes their note.
 *
 * The earlier `buildFieldSetCopy` helper was removed when PROFILE.md became
 * RO at the workspace level — `field_set` proposals now flow through the
 * `vobase contacts propose-change` CLI verb (which generates its own copy
 * via `insertProposal`), not through the workspace-sync observer.
 */

export interface ProposalCopy {
  rationale: string
  expectedOutcome: string
}

export interface BuildStaffSignalCopyOpts {
  agentName?: string
  signalKind: 'supervisor' | 'approval_rejected' | 'internal_note' | 'reassignment_note'
  /** Resolved actor name (e.g. "Bob"). Falls back to "A teammate" when unknown. */
  actorName?: string
  /** Short prose preview of the originating note (already capped upstream). */
  notePreview?: string
}

export function buildStaffSignalCopy(opts: BuildStaffSignalCopyOpts): ProposalCopy {
  const agent = opts.agentName?.trim() || 'The agent'
  const actor = opts.actorName?.trim() || 'A teammate'

  const lead =
    opts.signalKind === 'supervisor'
      ? `${actor} pinged ${agent} with a coaching note in this conversation.`
      : opts.signalKind === 'approval_rejected'
        ? `${actor} rejected an action ${agent} proposed.`
        : opts.signalKind === 'reassignment_note'
          ? `${actor} reassigned this conversation and left a note for ${agent}.`
          : `${actor} left ${agent} an internal note in this conversation.`

  const rationale = `${lead} Filing it as a lesson so ${agent} remembers it next time.`

  const note = opts.notePreview?.trim()
  const quote = note ? `\n\n“${note}”` : ''
  const expectedOutcome = `${agent} will keep this in mind on future conversations.${quote}`

  return { rationale, expectedOutcome }
}
