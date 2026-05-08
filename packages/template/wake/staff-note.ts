/**
 * Staff-note wake handler — processes `messaging:staff-note-to-wake` jobs
 * fired by `addNote` post-commit fan-out.
 *
 * One payload shape: every staff-note wake targets an explicitly @-mentioned
 * agent. The handler boots that agent with the staff_note trigger so it can
 * react to the note. The conversation assignee may be a different agent, the
 * mentioned agent itself (self-mention), or no agent at all (staff-owned
 * thread).
 *
 * Legacy payloads (older queue rows where `mentionedAgentId` is undefined)
 * fall back to `assigneeAgentId` / the live conversation assignee so a
 * version skew during deploy doesn't drop in-flight jobs.
 *
 * Mirrors the structure of `wake/inbound.ts` (conversation-lane inbound→wake) so
 * adding new triggers stays mechanical: parse payload → resolve agent →
 * build config with the explicit trigger → hand to `createHarness`.
 */

import type { AgentDefinition } from '@modules/agents/schema'
import { getById as getAgentDefinition } from '@modules/agents/service/agent-definitions'
import type { Conversation } from '@modules/messaging/schema'
import { get as getConversation } from '@modules/messaging/service/conversations'
import type { AgentContributions, HarnessLogger, ScopedScheduler } from '@vobase/core'
import { createHarness } from '@vobase/core'
import { z } from 'zod'

import type { RealtimeService, ScopedDb } from '~/runtime'
import type { WakeContext } from './context'
import { conversationWakeConfig } from './conversation'
import type { WakeTrigger } from './events'

/**
 * Job name + payload for the staff-note fan-out queue. Producer:
 * `modules/messaging/service/notes.ts::addNote` post-commit. Consumer:
 * `createStaffNoteWakeHandler` below (registered in `runtime/bootstrap.ts`).
 */
export const MESSAGING_STAFF_NOTE_TO_WAKE_JOB = 'messaging:staff-note-to-wake'

export const StaffNoteWakePayloadSchema = z.object({
  organizationId: z.string(),
  conversationId: z.string(),
  noteId: z.string(),
  authorUserId: z.string(),
  /**
   * Mentioned agent id (without `agent:` prefix). Producer always sets this;
   * `optional()` retains compatibility with legacy queue rows from before the
   * @-mention-only fan-out.
   */
  mentionedAgentId: z.string().optional(),
  /** Snapshot of the conversation assignee at fan-out time (without `agent:` prefix). */
  assigneeAgentId: z.string().optional(),
})

export type StaffNoteWakePayload = z.infer<typeof StaffNoteWakePayloadSchema>

export interface WakeHandlerDeps {
  realtime: RealtimeService
  db: ScopedDb
  logger: HarnessLogger
  jobs: ScopedScheduler
}

export function createStaffNoteWakeHandler(deps: WakeHandlerDeps, contributions: AgentContributions<WakeContext>) {
  return async function handleStaffNoteWake(rawData: unknown): Promise<void> {
    const data = rawData as StaffNoteWakePayload
    console.log('[wake:conv] handling staff-note→wake', {
      conv: data.conversationId,
      note: data.noteId,
      mentioned: data.mentionedAgentId ?? null,
    })

    let conv: Conversation
    try {
      conv = await getConversation(data.conversationId)
    } catch (err) {
      console.error('[wake:conv] conversation lookup failed:', err)
      return
    }

    // Resolve the agent to boot. Order:
    //   1. mentionedAgentId (peer wake) — use whatever the producer pinned.
    //   2. assigneeAgentId (assignee self-wake) — snapshot from fan-out time.
    //   3. derive from conv.assignee at handler time (covers payloads that
    //      pre-date this field).
    const fallbackAssigneeAgentId = conv.assignee.startsWith('agent:') ? conv.assignee.slice('agent:'.length) : null
    const resolvedAgentId = data.mentionedAgentId ?? data.assigneeAgentId ?? fallbackAssigneeAgentId ?? null

    if (!resolvedAgentId) {
      console.log('[wake:conv] skipping — no agent resolves for staff-note wake', {
        conv: data.conversationId,
        assignee: conv.assignee,
      })
      return
    }

    let agentDefinition: AgentDefinition
    try {
      agentDefinition = await getAgentDefinition(resolvedAgentId)
    } catch (err) {
      console.log('[wake:conv] skipping — agent_definitions row missing', { agentId: resolvedAgentId, err })
      return
    }

    // Synthesize the staff_note trigger; pass it through `triggerOverride`
    // so the renderer recognises the `mentionedAgentId` arm and the wake
    // boots on the staff_note variant rather than a defaulted inbound trigger.
    const triggerOverride: WakeTrigger = {
      trigger: 'staff_note',
      conversationId: data.conversationId,
      noteId: data.noteId,
      authorUserId: data.authorUserId,
      mentionedAgentId: data.mentionedAgentId,
    }

    try {
      const config = await conversationWakeConfig({
        data: {
          organizationId: data.organizationId,
          conversationId: data.conversationId,
          // The staff-note wake has no inbound message; pick a stable
          // sentinel so the legacy `messageIds` field on the inbound trigger
          // never leaks. The override below replaces the trigger entirely.
          messageId: '',
          contactId: conv.contactId,
        },
        conv,
        agentId: resolvedAgentId,
        agentDefinition,
        contributions,
        deps,
        triggerOverride,
      })
      await createHarness<WakeTrigger>(config)
    } catch (err) {
      console.error('[wake:conv] createHarness (staff_note) failed:', err)
    }
  }
}
