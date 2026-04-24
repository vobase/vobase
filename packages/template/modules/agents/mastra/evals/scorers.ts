import { createScorer } from '@mastra/core/evals'

import { models } from '../lib/models'
import { agentModel } from '../lib/provider'
import { coerce } from './coerce'

/**
 * Scorer registry — conversation-aware eval scorers.
 *
 * These are custom replacements for Mastra's prebuilt answerRelevancy and
 * faithfulness scorers. The prebuilt versions expect `run.output` to be
 * MastraDBMessage[] (they call `output.find(({ role }) => ...)`), but our
 * agents reply via tools (send_reply/send_card) so we score with plain
 * strings extracted from messaging.messages.
 *
 * Adding a new scorer here automatically flows through to manual scoring
 * in score-conversation.ts and the quality dashboard.
 */

const judgeModel = agentModel(models.gpt_mini)

interface KbSnippet {
  documentTitle: string
  content: string
}

function isKbSnippet(v: unknown): v is KbSnippet {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { documentTitle?: unknown }).documentTitle === 'string' &&
    typeof (v as { content?: unknown }).content === 'string'
  )
}

/** Format KB snippets from requestContext for inclusion in a judge prompt. */
function formatKbSnippets(run: { requestContext?: unknown }): string {
  const ctx = run.requestContext
  const raw =
    ctx && typeof ctx === 'object' && 'kbSnippets' in ctx ? (ctx as { kbSnippets?: unknown }).kbSnippets : undefined
  const snippets = Array.isArray(raw) ? raw.filter(isKbSnippet) : []
  if (snippets.length === 0) return '(no relevant knowledge base snippets found)'
  return snippets.map((s) => `- [${s.documentTitle}] ${s.content}`).join('\n')
}

// ─── Answer Relevancy ───────────────────────────────────────────────

const answerRelevancy = createScorer({
  id: 'answer-relevancy',
  name: 'Answer Relevancy',
  description:
    'Evaluates whether the agent reply is relevant to the customer message, informed by knowledge-base snippets.',
  judge: {
    model: judgeModel,
    instructions: `You are a balanced answer relevancy evaluator for a customer-facing agent.
Evaluate whether the agent's reply addresses what the customer is asking for.
Consider both direct answers and related context. Prioritize relevance over correctness.
Recognize that responses can be partially relevant.
When knowledge base snippets are provided, use them as the ideal-answer reference —
a reply that ignores an obviously relevant snippet is less relevant than one that uses it.`,
  },
})
  .generateScore({
    description: 'Score relevancy 0.0-1.0',
    createPrompt: ({ run }) =>
      [
        'Evaluate how relevant this agent reply is to the customer message.',
        '',
        `Customer message: ${coerce(run.input)}`,
        `Agent reply: ${coerce(run.output)}`,
        '',
        'Knowledge base snippets (reference material the agent had access to):',
        formatKbSnippets(run),
        '',
        'If the snippets cover the question, a relevant reply should draw on them.',
        '',
        'Score 0.0 if the reply is completely irrelevant or off-topic.',
        'Score 0.5 if the reply is partially relevant or only addresses part of the question.',
        'Score 1.0 if the reply directly and fully addresses what the customer asked.',
        'Respond with ONLY a number between 0.0 and 1.0.',
      ].join('\n'),
  })
  .generateReason({
    description: 'Explain relevancy score',
    createPrompt: ({ run, score }) =>
      [
        `Customer message: ${coerce(run.input)}`,
        `Agent reply: ${coerce(run.output)}`,
        '',
        'Knowledge base snippets:',
        formatKbSnippets(run),
        '',
        `Score: ${score}`,
        '',
        'Explain in 1-2 sentences why this score was given for relevancy, referencing the KB snippets if they were pertinent.',
      ].join('\n'),
  })

// ─── Faithfulness ───────────────────────────────────────────────────

const faithfulness = createScorer({
  id: 'faithfulness',
  name: 'Faithfulness',
  description: 'Evaluates whether the agent reply contains only factual, verifiable claims without hallucination.',
  judge: {
    model: judgeModel,
    instructions: `You are a faithfulness evaluator for a customer-facing agent.
Evaluate whether the agent's claims are supported by the conversation context.
Flag any fabricated details, made-up policies, or unsupported promises.
If the reply is a simple acknowledgment or greeting with no factual claims, score 1.0.`,
  },
})
  .generateScore({
    description: 'Score faithfulness 0.0-1.0',
    createPrompt: ({ run }) =>
      [
        'Evaluate whether this agent reply contains any hallucinated or unsupported claims.',
        '',
        `Customer message: ${coerce(run.input)}`,
        `Agent reply: ${coerce(run.output)}`,
        '',
        'Score 0.0 if the reply contains fabricated details, made-up policies, or unsupported promises.',
        'Score 0.5 if the reply mixes supported and unsupported claims.',
        'Score 1.0 if all claims are reasonable and no hallucination is apparent, or the reply has no factual claims.',
        'Respond with ONLY a number between 0.0 and 1.0.',
      ].join('\n'),
  })
  .generateReason({
    description: 'Explain faithfulness score',
    createPrompt: ({ run, score }) =>
      [
        `Customer message: ${coerce(run.input)}`,
        `Agent reply: ${coerce(run.output)}`,
        `Score: ${score}`,
        '',
        'Explain in 1-2 sentences what claims were unsupported, or confirm no hallucination was found.',
      ].join('\n'),
  })

export const scorers = [answerRelevancy, faithfulness] as const

export function getScorerMeta() {
  return scorers.map((s) => {
    let steps: Array<{ name: string; type: string; description?: string }> = []
    try {
      steps = s.getSteps()
    } catch {
      // Some scorers have steps without description — getSteps() throws
    }
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      hasJudge: !!s.judge,
      steps,
    }
  })
}
