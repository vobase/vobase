import {
  createAnswerRelevancyScorer,
  createFaithfulnessScorer,
} from '@mastra/evals/scorers/prebuilt';

import { models } from '../lib/models';

/**
 * Create eval scorers for assessing agent response quality.
 * Uses gpt_mini as the LLM judge.
 *
 * - Answer Relevancy: measures how relevant the response is to the user's question
 * - Faithfulness: measures whether the response is grounded in the provided context
 *
 * These scorers call an LLM (LLM-as-judge) and should be run asynchronously,
 * not in the request path.
 */
export function createScorerSuite() {
  return {
    answerRelevancy: createAnswerRelevancyScorer({ model: models.gpt_mini }),
    faithfulness: createFaithfulnessScorer({ model: models.gpt_mini }),
  };
}
