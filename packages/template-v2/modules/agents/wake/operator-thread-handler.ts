/**
 * Operator-thread wake handler — processes `agents:operator-thread-to-wake`
 * jobs by booting an operator wake via `createHarness` from `@vobase/core`.
 *
 * Symmetric to `wake/handler.ts` (the concierge inbound→wake consumer), but
 * routes through `buildOperatorWakeConfig` instead. Producer is the operator
 * chat surface (lands with §9.9): after writing the staff message via
 * `threads.appendMessage`, the surface calls `jobs.send(OPERATOR_THREAD_TO_WAKE_JOB, ...)`.
 *
 * The handler reads the latest user-role message off the thread to populate
 * `data.threadMessage` for the operator brief side-load.
 */

import type { WakeTrigger } from '@modules/agents/events'
import { agentThreadMessages, agentThreads } from '@modules/agents/schema'
import { getById as getAgentDefinition } from '@modules/agents/service/agent-definitions'
import type { AgentContributions, HarnessLogger } from '@vobase/core'
import { createHarness } from '@vobase/core'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import type { RealtimeService, ScopedDb } from '~/runtime'
import { buildOperatorWakeConfig } from './build-config/operator'

export const OPERATOR_THREAD_TO_WAKE_JOB = 'agents:operator-thread-to-wake'

export const OperatorThreadToWakePayloadSchema = z.object({
  organizationId: z.string(),
  threadId: z.string(),
  /** Optional — if omitted the handler reads the most recent user message. */
  messageId: z.string().optional(),
})

export type OperatorThreadToWakePayload = z.infer<typeof OperatorThreadToWakePayloadSchema>

export interface OperatorThreadHandlerDeps {
  realtime: RealtimeService
  db: ScopedDb
  logger: HarnessLogger
}

export function createOperatorThreadWakeHandler(deps: OperatorThreadHandlerDeps, contributions: AgentContributions) {
  return async function handleOperatorThreadToWake(rawData: unknown): Promise<void> {
    const data = rawData as OperatorThreadToWakePayload
    console.log('[op-wake] handling operator-thread→wake', { thread: data.threadId })

    const threadRow = await deps.db
      .select({
        id: agentThreads.id,
        organizationId: agentThreads.organizationId,
        agentId: agentThreads.agentId,
        status: agentThreads.status,
      })
      .from(agentThreads)
      .where(eq(agentThreads.id, data.threadId))
      .limit(1)
      .then((rows) => rows[0])
    if (!threadRow) {
      console.error('[op-wake] thread not found', { thread: data.threadId })
      return
    }
    if (threadRow.status !== 'open') {
      console.log('[op-wake] skipping — thread is not open', { thread: data.threadId, status: threadRow.status })
      return
    }

    const latestMsgRow = await deps.db
      .select({ content: agentThreadMessages.content })
      .from(agentThreadMessages)
      .where(eq(agentThreadMessages.threadId, data.threadId))
      .orderBy(desc(agentThreadMessages.seq))
      .limit(1)
      .then((rows) => rows[0])
    const threadMessage = latestMsgRow?.content ?? ''

    try {
      const agentDefinition = await getAgentDefinition(threadRow.agentId)
      const config = await buildOperatorWakeConfig({
        data: {
          organizationId: threadRow.organizationId,
          triggerKind: 'operator_thread',
          threadId: data.threadId,
          threadMessage,
        },
        agentId: threadRow.agentId,
        agentDefinition,
        contributions,
        deps,
      })
      await createHarness<WakeTrigger>(config)
    } catch (err) {
      console.error('[op-wake] createHarness failed:', err)
    }
  }
}
