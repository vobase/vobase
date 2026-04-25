/**
 * Wake handler — processes `channels:inbound-to-wake` jobs by booting a
 * wake via `createHarness` from `@vobase/core`. Sole consumer of that job;
 * sole producer of agent replies on every channel.
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

import type { WakeTrigger } from '@modules/agents/events'
import { getById as getAgentDefinition } from '@modules/agents/service/agent-definitions'
import type { Conversation } from '@modules/messaging/schema'
import { get as getConversation } from '@modules/messaging/service/conversations'
import type { AgentContributions, HarnessLogger } from '@vobase/core'
import { createHarness } from '@vobase/core'
import { z } from 'zod'

import type { RealtimeService, ScopedDb } from '~/runtime'
import { buildWakeConfig } from './build-config'

/**
 * Job name + payload for inbound-to-wake dispatch.
 * Producers: `modules/channels/service/inbound.ts` (generic) and
 * `modules/channels/adapters/web/handlers/card-reply.ts` (in-app card replies).
 * Consumer: `createWakeHandler` below (registered in `runtime/bootstrap.ts`).
 */
export const INBOUND_TO_WAKE_JOB = 'channels:inbound-to-wake'

export const InboundToWakePayloadSchema = z.object({
  organizationId: z.string(),
  conversationId: z.string(),
  messageId: z.string(),
  contactId: z.string(),
})

export type InboundToWakePayload = z.infer<typeof InboundToWakePayloadSchema>

export interface WakeHandlerDeps {
  realtime: RealtimeService
  db: ScopedDb
  logger: HarnessLogger
}

export function createWakeHandler(deps: WakeHandlerDeps, contributions: AgentContributions) {
  return async function handleInboundToWake(rawData: unknown): Promise<void> {
    const data = rawData as InboundToWakePayload
    console.log('[wake] handling inbound→wake', { conv: data.conversationId, msg: data.messageId })

    let conv: Conversation
    try {
      conv = await getConversation(data.conversationId)
    } catch (err) {
      console.error('[wake] conversation lookup failed:', err)
      return
    }
    if (!conv.assignee.startsWith('agent:')) {
      console.log('[wake] skipping — assignee is not an agent', { assignee: conv.assignee })
      return
    }
    const agentId = conv.assignee.slice('agent:'.length)
    console.log('[wake] booting wake', { agentId, contactId: data.contactId })

    try {
      const agentDefinition = await getAgentDefinition(agentId)
      const config = await buildWakeConfig({ data, conv, agentId, agentDefinition, contributions, deps })
      await createHarness<WakeTrigger>(config)
    } catch (err) {
      console.error('[wake] createHarness failed:', err)
    }
  }
}
