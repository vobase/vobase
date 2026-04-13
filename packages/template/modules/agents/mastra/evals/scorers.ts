import {
  createAnswerRelevancyScorer,
  createFaithfulnessScorer,
} from '@mastra/evals/scorers/prebuilt';

import { models } from '../lib/models';
import { agentModel } from '../lib/provider';

/**
 * Scorer registry — all code-based eval scorers.
 *
 * Adding a new scorer here automatically registers on the Mastra instance
 * and flows through to the quality dashboard.
 */

const answerRelevancy = createAnswerRelevancyScorer({
  model: agentModel(models.gpt_mini),
});

const faithfulness = createFaithfulnessScorer({
  model: agentModel(models.gpt_mini),
});

export const scorers = [answerRelevancy, faithfulness] as const;

export function getScorerMeta() {
  return scorers.map((s) => {
    let steps: Array<{ name: string; type: string; description?: string }> = [];
    try {
      steps = s.getSteps();
    } catch {
      // Some prebuilt scorers have steps without description — getSteps() throws
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
