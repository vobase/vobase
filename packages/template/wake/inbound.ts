/**
 * Wake handler — processes `agents:wake` jobs by booting a wake via
 * `createHarness` from `@vobase/core`. Sole consumer of that job; sole
 * producer of agent replies on every channel.
 *
 * Agents only run when the conversation's assignee is an `agent:<id>`. If the
 * assignee is a user or unassigned, the wake is skipped — no fallback agent.
 *
 * The heavy assembly (workspace creation, frozen prompt, listener wiring,
 * materializer composition, idle-resumption, message-history) lives in
 * `build-config.ts`. This file owns only the orchestration: parse payload,
 * gate by assignee, look up the agent definition, build the config, hand it
 * to `createHarness`.
 */

import { getById as getAgentDefinition } from '@modules/agents/service/agent-definitions'
import type { Conversation } from '@modules/messaging/schema'
import { get as getConversation } from '@modules/messaging/service/conversations'
import type { AgentContributions, HarnessLogger } from '@vobase/core'
import { createHarness } from '@vobase/core'
import { z } from 'zod'

import type { RealtimeService, ScopedDb } from '~/runtime'
import type { WakeContext } from './context'
import { conversationWakeConfig } from './conversation'
import { type WakeTrigger, WakeTriggerSchema } from './events'

/**
 * Job name + payload for the conversation-lane wake bus. One queue carries
 * every producer that needs to wake an agent against a conversation:
 * inbound channel messages, in-app card replies, drive `caption_ready`
 * post-OCR wakes, and any future producer that lands here.
 *
 * Producers: `modules/channels/service/inbound.ts` (generic),
 * `modules/channels/adapters/web/handlers/card-reply.ts` (in-app card replies),
 * and `modules/drive/jobs.ts` (caption_ready wakes after binary OCR).
 * Consumer: `createWakeHandler` below (registered in `runtime/bootstrap.ts`).
 *
 * `messageId` is optional because non-inbound-message triggers (e.g.
 * `caption_ready`) have no inbound message to point at. `trigger` is also
 * optional for back-compat with the long-lived inbound-message producer
 * shape — when omitted, the handler synthesizes the default
 * `inbound_message` trigger from `messageId`.
 */
export const AGENTS_WAKE_JOB = 'agents:wake'

export const AgentsWakePayloadSchema = z.object({
  organizationId: z.string(),
  conversationId: z.string(),
  contactId: z.string(),
  messageId: z.string().optional(),
  trigger: WakeTriggerSchema.optional(),
})

export type AgentsWakePayload = z.infer<typeof AgentsWakePayloadSchema>

export interface WakeHandlerDeps {
  realtime: RealtimeService
  db: ScopedDb
  logger: HarnessLogger
}

export function createWakeHandler(deps: WakeHandlerDeps, contributions: AgentContributions<WakeContext>) {
  return async function handleInboundToWake(rawData: unknown): Promise<void> {
    const data = rawData as AgentsWakePayload
    console.log('[wake:conv] handling inbound→wake', {
      conv: data.conversationId,
      msg: data.messageId,
      trig: data.trigger?.trigger ?? 'inbound_message',
    })

    // Synthesize triggerOverride at the handler boundary. If the producer
    // sent an explicit `trigger` (e.g. `caption_ready` from drive jobs),
    // forward it unchanged. Otherwise reconstruct the default
    // `inbound_message` trigger from the legacy `messageId` field.
    let triggerOverride: WakeTrigger | undefined
    if (data.trigger) {
      triggerOverride = data.trigger
    } else if (data.messageId) {
      triggerOverride = {
        trigger: 'inbound_message',
        conversationId: data.conversationId,
        messageIds: [data.messageId],
      }
    } else {
      console.warn('[wake:conv] payload has neither trigger nor messageId — skipping')
      return
    }

    let conv: Conversation
    try {
      conv = await getConversation(data.conversationId)
    } catch (err) {
      console.error('[wake:conv] conversation lookup failed:', err)
      return
    }
    if (!conv.assignee.startsWith('agent:')) {
      console.log('[wake:conv] skipping — assignee is not an agent', { assignee: conv.assignee })
      return
    }
    const agentId = conv.assignee.slice('agent:'.length)
    console.log('[wake:conv] booting wake', { agentId, contactId: data.contactId })

    try {
      const agentDefinition = await getAgentDefinition(agentId)
      const config = await conversationWakeConfig({
        data,
        conv,
        agentId,
        agentDefinition,
        contributions,
        deps,
        triggerOverride,
      })
      await createHarness<WakeTrigger>(config)
    } catch (err) {
      console.error('[wake:conv] createHarness failed:', err)
    }
  }
}
