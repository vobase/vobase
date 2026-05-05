/**
 * createLearningProposalObserver — closes the self-learn loop.
 *
 * On every wake we accumulate `AgentEvent`s and, at `agent_end`, run
 * `detectStaffSignals` to extract staff-side teaching moments. Each non-trivial
 * signal turns into an `agent_memory` change-proposal (markdown_patch / append).
 * Because `agent_memory` is registered with `requiresApproval: false`, the
 * proposal materializes immediately and surfaces in the History tab — no manual
 * approval required.
 *
 * Idempotency relies on the partial unique index on
 * `(org, resourceModule, resourceType, resourceId)` for status='pending'; a
 * concurrent insert race surfaces as a `conflict` error which we swallow.
 */

import { detectStaffSignals } from '@modules/agents/service/staff-signals'
import { insertProposal } from '@modules/changes/service/proposals'
import { listNotes } from '@modules/messaging/service/notes'
import type { ChangePayload, HarnessLogger } from '@vobase/core'

import type { AgentEvent } from '../events'

/** Cap on the inline note body surfaced in the rendered staff-signal block. */
const NOTE_PREVIEW_MAX_CHARS = 800

export interface LearningProposalObserverOpts {
  organizationId: string
  agentId: string
  conversationId?: string | null
  logger: HarnessLogger
}

export function createLearningProposalObserver(
  opts: LearningProposalObserverOpts,
): (event: AgentEvent) => Promise<void> {
  const { organizationId, agentId, conversationId, logger } = opts
  const buffers = new Map<string, AgentEvent[]>()

  return async (event: AgentEvent): Promise<void> => {
    if (event.type === 'agent_aborted') {
      buffers.delete(event.wakeId)
      return
    }
    // detectStaffSignals only inspects agent_start + internal_note_added; skip
    // hot-path events (message_update, llm_call, tool_*) entirely. agent_end
    // stays so the flush still fires.
    if (event.type !== 'agent_start' && event.type !== 'internal_note_added' && event.type !== 'agent_end') {
      return
    }

    const buf = buffers.get(event.wakeId) ?? []
    buf.push(event)
    buffers.set(event.wakeId, buf)

    if (event.type !== 'agent_end') return
    buffers.delete(event.wakeId)

    const signals = detectStaffSignals(buf)
    for (const signal of signals) {
      // `reassignment_note` fires from a `manual` trigger the agent never saw — not
      // a teachable moment for working memory; skip.
      if (signal.kind === 'reassignment_note') continue

      // Resolve the note body for `supervisor` and `internal_note` signals — the
      // wake event itself only carries `noteId`, so without this lookup the
      // rendered block would show a useless `Note: —` stub. We bound the preview
      // at NOTE_PREVIEW_MAX_CHARS so working_memory growth stays predictable.
      let notePreview = signal.notePreview
      if (
        notePreview === undefined &&
        conversationId &&
        (signal.kind === 'supervisor' || signal.kind === 'internal_note')
      ) {
        try {
          const notes = await listNotes(conversationId)
          const found = notes.find((n) => n.id === signal.ref)
          if (found) notePreview = found.body.slice(0, NOTE_PREVIEW_MAX_CHARS)
        } catch (err) {
          logger.warn({ err, kind: signal.kind, ref: signal.ref }, 'learning-proposals: note lookup failed')
        }
      }

      // Blank-but-present notePreview produces useless `Note: —` stubs; an undefined
      // notePreview is fine — the agent reads the body via `cat` at runtime.
      if (notePreview !== undefined && notePreview.trim() === '') {
        logger.info({ agentId, kind: signal.kind, ref: signal.ref }, 'learning-proposals: empty note — skipped')
        continue
      }

      const body = [
        '',
        `## Staff signal — ${signal.kind} @ ${signal.ts}`,
        `- Author: ${signal.actorUserId ?? 'unknown'}`,
        `- Ref: ${signal.ref}`,
        `- Note: ${notePreview ?? '—'}`,
      ].join('\n')

      const payload: ChangePayload = {
        kind: 'markdown_patch',
        mode: 'append',
        field: 'workingMemory',
        body,
      }

      try {
        await insertProposal({
          organizationId,
          resourceModule: 'agents',
          resourceType: 'agent_memory',
          resourceId: agentId,
          payload,
          changedBy: `agent:${agentId}`,
          changedByKind: 'agent',
          confidence: 0.6,
          rationale: `Captured staff signal: ${signal.kind}`,
          expectedOutcome: 'Future wakes will see this lesson in working memory.',
          conversationId: conversationId ?? null,
        })
      } catch (err) {
        if (err instanceof Error && /already has a pending proposal/.test(err.message)) {
          logger.info(
            { agentId, kind: signal.kind, ref: signal.ref },
            'learning-proposals: duplicate pending — skipped',
          )
          continue
        }
        logger.error({ err, agentId, kind: signal.kind }, 'learning-proposals: insertProposal failed')
      }
    }
  }
}
