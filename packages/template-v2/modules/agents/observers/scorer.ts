/**
 * scorerObserver — fires `llmCall('scorer.answer_relevancy', ...)` + `llmCall('scorer.faithfulness', ...)`
 * on every `turn_end`, writing two rows to the existing `agent_scores` table.
 *
 * Fire-and-forget discipline: the observer runs in its own AsyncQueue on the observer bus,
 * so slow LLM calls here never backpressure the hot path or other observers.
 *
 * Per-wake `emitter` handle is the one populated by `createHarness({ emitEventHandle })`
 * so `llm_call` + `scorer_recorded` events surface into the stream uniformly.
 */

import type { AgentEvent } from '@server/contracts/event'
import type { AgentObserver } from '@server/contracts/observer'
import { type LlmEmitter, llmCall } from '@server/harness/llm-call'
import { getDb, getLogger } from '@server/services'

export interface ScorerObserverOpts {
  emitter?: LlmEmitter
}

interface ScoreResult {
  score: number
  rationale: string | null
}

function parseScoreResult(raw: string): ScoreResult {
  try {
    const parsed = JSON.parse(raw) as { score?: unknown; rationale?: unknown }
    const score = typeof parsed.score === 'number' ? Math.max(0, Math.min(1, parsed.score)) : 0.5
    const rationale = typeof parsed.rationale === 'string' ? parsed.rationale : null
    return { score, rationale }
  } catch {
    return { score: 0.5, rationale: null }
  }
}

export function createScorerObserver(opts: ScorerObserverOpts = {}): AgentObserver {
  const { emitter } = opts

  /** Buffer of messages per wakeId — cleared on agent_end to prevent leaks. */
  const wakeMessages = new Map<string, Array<{ role: string; content: string }>>()

  return {
    id: 'agents:scorer',

    async handle(event: AgentEvent): Promise<void> {
      if (event.type === 'message_end' && event.content?.trim()) {
        const buf = wakeMessages.get(event.wakeId) ?? []
        buf.push({ role: event.role, content: event.content.trim() })
        wakeMessages.set(event.wakeId, buf)
        return
      }

      if (event.type === 'agent_end') {
        wakeMessages.delete(event.wakeId)
        return
      }

      if (event.type !== 'turn_end') return

      const msgs = wakeMessages.get(event.wakeId) ?? []
      const lastUser = [...msgs].reverse().find((m) => m.role === 'user')?.content ?? ''
      const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant')?.content ?? ''

      const { agentScores } = await import('@modules/agents/schema')
      const { nanoid } = await import('nanoid')

      const { scorerAnswerRelevancySystemPrompt, buildAnswerRelevancyUserMessage } = await import(
        '@modules/agents/llm-prompts/scorer-answer-relevancy'
      )

      const { scorerFaithfulnessSystemPrompt, buildFaithfulnessUserMessage } = await import(
        '@modules/agents/llm-prompts/scorer-faithfulness'
      )

      const scorers: Array<{
        scorerId: string
        task: 'scorer.answer_relevancy' | 'scorer.faithfulness'
        system: string
        userMessage: string
      }> = [
        {
          scorerId: 'answer_relevancy',
          task: 'scorer.answer_relevancy',
          system: scorerAnswerRelevancySystemPrompt,
          userMessage: buildAnswerRelevancyUserMessage(lastUser, lastAssistant),
        },
        {
          scorerId: 'faithfulness',
          task: 'scorer.faithfulness',
          system: scorerFaithfulnessSystemPrompt,
          userMessage: buildFaithfulnessUserMessage(lastAssistant),
        },
      ]

      const logger = getLogger()
      const db = getDb()
      const wake = {
        organizationId: event.organizationId,
        conversationId: event.conversationId,
        wakeId: event.wakeId,
        turnIndex: event.turnIndex,
      }

      for (const { scorerId, task, system, userMessage } of scorers) {
        try {
          const result = await llmCall({
            wake,
            task,
            request: {
              system,
              messages: [{ role: 'user', content: userMessage }],
            },
            emitter,
          })

          const { score, rationale } = parseScoreResult(result.content)

          await db.insert(agentScores).values({
            id: nanoid(8),
            organizationId: event.organizationId,
            conversationId: event.conversationId,
            wakeTurnIndex: event.turnIndex,
            scorer: scorerId,
            score,
            rationale,
            model: result.model,
          })

          emitter?.emit?.({
            type: 'scorer_recorded',
            scorerId,
            score,
            sourceLlmTask: task,
            ts: new Date(),
            wakeId: event.wakeId,
            conversationId: event.conversationId,
            organizationId: event.organizationId,
            turnIndex: event.turnIndex,
          })
        } catch (err) {
          logger.warn({ err, scorerId }, 'scorer: failed to score turn — skipping')
        }
      }
    },
  }
}
