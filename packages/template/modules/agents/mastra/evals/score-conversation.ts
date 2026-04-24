/**
 * Manual conversation scoring — runs scorers against the actual messages
 * sent to and from the customer, not the raw LLM output.
 *
 * Agents reply via tools (send_reply, send_card) so Mastra's automatic
 * scorer receives meaningless input/output. This module queries
 * messaging.messages for the real conversation content and scores that.
 */
import { randomUUID } from 'node:crypto'
import type { MastraScorer } from '@mastra/core/evals'
import { hybridSearch } from '@modules/knowledge-base/lib/search'
import type { VobaseDb } from '@vobase/core'
import { logger } from '@vobase/core'
import { and, desc, eq, gte } from 'drizzle-orm'

import { messages } from '../../../messaging/schema'
import { getMastra } from '../index'
import { buildCustomScorer } from './custom-scorer-factory'
import { scorers } from './scorers'

// ─── Message extraction ─────────────────────────────────────────────

interface ConversationMessages {
  /** Last inbound customer message (the trigger). */
  customerMessage: string
  /** All agent replies sent during this wake (concatenated). */
  agentReply: string
  /** IDs of the agent messages scored in this wake (chronological). */
  agentMessageIds: string[]
}

/**
 * Extract the last customer message and agent replies from a conversation
 * that were created after `since` (the wake start time).
 */
async function extractConversationMessages(
  db: VobaseDb,
  conversationId: string,
  since: Date,
): Promise<ConversationMessages | null> {
  // Fetch the last inbound message before or at wake time
  // (the message that triggered the wake)
  const [lastInbound] = await db
    .select({ content: messages.content, contentType: messages.contentType })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.messageType, 'incoming')))
    .orderBy(desc(messages.createdAt))
    .limit(1)

  if (!lastInbound) return null

  // Fetch agent replies sent during this wake
  const agentReplies = await db
    .select({
      id: messages.id,
      content: messages.content,
      contentType: messages.contentType,
    })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.senderType, 'agent'),
        eq(messages.messageType, 'outgoing'),
        gte(messages.createdAt, since),
      ),
    )
    .orderBy(messages.createdAt)

  if (agentReplies.length === 0) return null

  const customerMessage = lastInbound.contentType === 'image' ? '(customer sent an image)' : lastInbound.content

  const agentReply = agentReplies.map((r) => r.content).join('\n\n')

  return {
    customerMessage,
    agentReply,
    agentMessageIds: agentReplies.map((r) => r.id),
  }
}

// ─── Score persistence ──────────────────────────────────────────────

interface ScoreConversationOptions {
  db: VobaseDb
  conversationId: string
  agentId: string
  /** Timestamp just before agent.generate() was called. */
  wakeStart: Date
}

/**
 * Run all registered scorers against the real conversation messages
 * and persist results to Mastra's scores store.
 *
 * Designed to be called after agent.generate() completes in agent-wake.
 * Runs in the background — errors are logged, never thrown.
 */
export async function scoreConversation(opts: ScoreConversationOptions): Promise<void> {
  const { db, conversationId, agentId, wakeStart } = opts

  try {
    const extracted = await extractConversationMessages(db, conversationId, wakeStart)

    if (!extracted) {
      logger.debug('[scorer] No messages to score', { conversationId })
      return
    }

    const mastra = getMastra()
    const storage = mastra.getStorage()
    if (!storage) {
      logger.warn('[scorer] No storage available, skipping scoring')
      return
    }

    const scoresStore = await storage.getStore('scores')
    if (!scoresStore) {
      logger.warn('[scorer] Scores store not available, skipping scoring')
      return
    }

    const runId = randomUUID()
    const threadId = `agent-${agentId}-conv-${conversationId}`

    // Pre-fetch KB snippets so scorers (answer-relevancy) can judge the reply
    // against the authoritative reference material the agent had access to.
    const kbSnippets = await hybridSearch(db, extracted.customerMessage, {
      limit: 3,
      mode: 'fast',
    }).catch((err) => {
      logger.debug('[scorer] KB search failed, continuing without snippets', {
        conversationId,
        error: err,
      })
      return []
    })

    // Resolve all scorers: code-based + custom from DB
    const allScorers: MastraScorer[] = [...scorers]
    try {
      const defsStore = await storage.getStore('scorerDefinitions')
      if (defsStore) {
        const result = (await defsStore.listResolved()) as Record<string, unknown>
        const rawDefs = Array.isArray(result?.scorerDefinitions)
          ? (result.scorerDefinitions as Record<string, unknown>[])
          : []
        for (const def of rawDefs.filter((d) => d.status === 'published')) {
          const metadata = (def.metadata ?? {}) as Record<string, unknown>
          allScorers.push(
            buildCustomScorer({
              id: def.id as string,
              name: (def.name as string) ?? '',
              description: (def.description as string) ?? '',
              criteria: (def.instructions as string) ?? '',
              model: (metadata.model as string) ?? '',
            }),
          )
        }
      }
    } catch {
      // Custom scorer resolution is best-effort
    }

    // Run each scorer concurrently. kbSnippets is passed to the scorer via
    // requestContext (not persisted); messageIds link this run's scores back
    // to the specific agent messages so the UI can attach scores per-message.
    const results = await Promise.allSettled(
      allScorers.map(async (scorer) => {
        const result = await scorer.run({
          input: extracted.customerMessage,
          output: extracted.agentReply,
          requestContext: { kbSnippets },
        })

        if (result && typeof result.score === 'number') {
          await scoresStore.saveScore({
            scorerId: scorer.id,
            entityId: agentId,
            runId,
            input: extracted.customerMessage,
            output: extracted.agentReply,
            score: result.score,
            reason: result.reason ?? undefined,
            scorer: {
              id: scorer.id,
              name: scorer.name ?? scorer.id,
              description: scorer.description ?? '',
            },
            entity: { id: agentId, name: agentId },
            entityType: 'AGENT',
            source: 'LIVE',
            threadId,
            requestContext: {
              conversationId,
              messageIds: extracted.agentMessageIds,
            },
          })
        }

        return { scorerId: scorer.id, score: result?.score ?? null }
      }),
    )

    const succeeded = results.filter((r) => r.status === 'fulfilled').length
    const failed = results.filter((r) => r.status === 'rejected')

    if (failed.length > 0) {
      for (const f of failed) {
        logger.warn('[scorer] Scorer failed', {
          conversationId,
          error: (f as PromiseRejectedResult).reason,
        })
      }
    }

    logger.debug('[scorer] Scoring complete', {
      conversationId,
      succeeded,
      failed: failed.length,
    })
  } catch (err) {
    logger.error('[scorer] Conversation scoring failed', {
      conversationId,
      error: err,
    })
  }
}
