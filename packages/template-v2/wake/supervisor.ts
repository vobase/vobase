/**
 * Supervisor wake handler — processes `messaging:supervisor-to-wake` jobs
 * fired by `addNote` post-commit fan-out.
 *
 * Two payload variants share this handler:
 *   - **Assignee self-wake** — `mentionedAgentId` is undefined; the handler
 *     boots the conversation's current agent assignee with the supervisor
 *     trigger so it can react to the staff note.
 *   - **Peer wake** — `mentionedAgentId` is set; the handler boots the
 *     mentioned agent (using its OWN builder lane) with the supervisor
 *     trigger flagged as a mention. The conversation assignee may be a
 *     different agent or no agent at all.
 *
 * Mirrors the structure of `wake/handler.ts` (conversation-lane inbound→wake) so
 * adding new triggers stays mechanical: parse payload → resolve agent →
 * build config with the explicit trigger → hand to `createHarness`.
 */

import type { AgentDefinition } from '@modules/agents/schema'
import { getById as getAgentDefinition } from '@modules/agents/service/agent-definitions'
import type { Conversation } from '@modules/messaging/schema'
import { get as getConversation } from '@modules/messaging/service/conversations'
import type { AgentContributions, HarnessLogger } from '@vobase/core'
import { createHarness } from '@vobase/core'
import { z } from 'zod'

import type { RealtimeService, ScopedDb } from '~/runtime'
import type { WakeContext } from './context'
import { conversationWakeConfig } from './conversation'
import type { WakeTrigger } from './events'

/**
 * Job name + payload for the supervisor fan-out queue. Producer:
 * `modules/messaging/service/notes.ts::addNote` post-commit. Consumer:
 * `createSupervisorWakeHandler` below (registered in `runtime/bootstrap.ts`).
 */
export const MESSAGING_SUPERVISOR_TO_WAKE_JOB = 'messaging:supervisor-to-wake'

export const SupervisorWakePayloadSchema = z.object({
  organizationId: z.string(),
  conversationId: z.string(),
  noteId: z.string(),
  authorUserId: z.string(),
  /** Set for peer wakes; undefined for the assignee self-wake. */
  mentionedAgentId: z.string().optional(),
  /** Snapshot of the conversation assignee at fan-out time (without `agent:` prefix). */
  assigneeAgentId: z.string().optional(),
})

export type SupervisorWakePayload = z.infer<typeof SupervisorWakePayloadSchema>

export interface WakeHandlerDeps {
  realtime: RealtimeService
  db: ScopedDb
  logger: HarnessLogger
}

export function createSupervisorWakeHandler(deps: WakeHandlerDeps, contributions: AgentContributions<WakeContext>) {
  return async function handleSupervisorWake(rawData: unknown): Promise<void> {
    const data = rawData as SupervisorWakePayload
    console.log('[wake:conv] handling supervisor→wake', {
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
      console.log('[wake:conv] skipping — no agent resolves for supervisor wake', {
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

    // Synthesize the supervisor trigger; pass it through `triggerOverride`
    // so the renderer recognises the `mentionedAgentId` arm and the wake
    // boots on the supervisor variant rather than a defaulted inbound trigger.
    const triggerOverride: WakeTrigger = {
      trigger: 'supervisor',
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
          // The supervisor wake has no inbound message; pick a stable
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
      console.error('[wake:conv] createHarness (supervisor) failed:', err)
    }
  }
}
