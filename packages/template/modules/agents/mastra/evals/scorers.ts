import { createScorer } from '@mastra/core/evals';

import { models } from '../lib/models';
import { agentModel } from '../lib/provider';

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

const judgeModel = agentModel(models.gpt_mini);

function coerce(val: unknown): string {
  return typeof val === 'string' ? val : JSON.stringify(val);
}

// ─── Answer Relevancy ───────────────────────────────────────────────

const answerRelevancy = createScorer({
  id: 'answer-relevancy',
  name: 'Answer Relevancy',
  description:
    'Evaluates whether the agent reply is relevant to the customer message.',
  judge: {
    model: judgeModel,
    instructions: `You are a balanced answer relevancy evaluator for a customer-facing agent.
Evaluate whether the agent's reply addresses what the customer is asking for.
Consider both direct answers and related context. Prioritize relevance over correctness.
Recognize that responses can be partially relevant.`,
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
        `Score: ${score}`,
        '',
        'Explain in 1-2 sentences why this score was given for relevancy.',
      ].join('\n'),
  });

// ─── Faithfulness ───────────────────────────────────────────────────

const faithfulness = createScorer({
  id: 'faithfulness',
  name: 'Faithfulness',
  description:
    'Evaluates whether the agent reply contains only factual, verifiable claims without hallucination.',
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
  });

export const scorers = [answerRelevancy, faithfulness] as const;

export function getScorerMeta() {
  return scorers.map((s) => {
    let steps: Array<{ name: string; type: string; description?: string }> = [];
    try {
      steps = s.getSteps();
    } catch {
      // Some scorers have steps without description — getSteps() throws
    }
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      hasJudge: !!s.judge,
      steps,
    };
  });
}
