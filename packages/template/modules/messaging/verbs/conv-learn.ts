/**
 * `vobase conv learn` — run a learning pass over a conversation.
 *
 * Staff (or an operator from the binary) trigger a one-off learning-triage
 * sweep over a single thread; the agent later extracts durable lessons / facts
 * / change proposals from the history. Primary use: backfilled WhatsApp-
 * coexistence threads the agent never woke on. Candidates surface in the
 * agent's next wake (reuses the existing side-load + `remember` flow).
 *
 * Conversation-scoped: the in-process transport injects `ctx.wake.conversationId`;
 * HTTP-RPC callers pass `--conversationId=<id>`. Always enqueued — the automatic
 * kill-switch (`LEARN_AUTO_TRIAGE`) does not gate the manual path.
 */

import { get as getConversation } from '@modules/messaging/service/conversations'
import { ManualLearningError, triggerLearning } from '@modules/messaging/service/manual-learning'
import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

export const convLearnVerb = defineCliVerb({
  name: 'conv learn',
  description:
    "Run a learning pass over this conversation. The agent extracts durable lessons, facts, and change proposals from the thread history; results surface in its next wake. Useful for backfilled WhatsApp history the agent never woke on. Optionally pass --agentId to attribute the learning; otherwise it resolves from the conversation assignee, then the channel's default agent.",
  usage: 'vobase conv learn [--agentId=<id>] [--conversationId=<id>]',
  audience: 'staff',
  input: z.object({
    agentId: z.string().optional(),
    /** Honored only for out-of-wake HTTP-RPC; inside a wake, ctx.wake.conversationId is authoritative and this is ignored. */
    conversationId: z.string().optional(),
  }),
  body: async ({ input, ctx }) => {
    // Inside a wake the conversation is fixed by the harness; an in-wake agent must
    // not be able to learn on a different conversation by passing a stray
    // --conversationId. The flag is only honored out-of-wake (HTTP-RPC, ctx.wake undefined).
    const conversationId = ctx.wake?.conversationId ?? input.conversationId
    if (!conversationId) {
      return {
        ok: false as const,
        error: '--conversationId is required (or invoke from within a wake)',
        errorCode: 'invalid_input',
      }
    }

    // Tenant scoping: never let one org trigger learning on another's thread.
    let conv: Awaited<ReturnType<typeof getConversation>> | null
    try {
      conv = await getConversation(conversationId)
    } catch {
      return { ok: false as const, error: `conversation ${conversationId} not found`, errorCode: 'not_found' }
    }
    if (conv.organizationId !== ctx.organizationId) {
      return { ok: false as const, error: 'conversation not in this organization', errorCode: 'forbidden' }
    }

    try {
      const result = await triggerLearning({ conversationId, agentId: input.agentId })
      return {
        ok: true as const,
        data: result,
        summary:
          result.windowCount === 0
            ? `No messages to learn from in conversation ${conversationId}.`
            : `Queued ${result.windowCount} learning window${result.windowCount === 1 ? '' : 's'} over ${result.messageCount} message${result.messageCount === 1 ? '' : 's'} for agent ${result.agentId}. Candidates will surface in its next wake.`,
      }
    } catch (e) {
      if (e instanceof ManualLearningError) {
        return { ok: false as const, error: e.message, errorCode: e.code }
      }
      throw e
    }
  },
  formatHint: 'json',
})
