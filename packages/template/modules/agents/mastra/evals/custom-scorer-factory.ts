import { createScorer } from '@mastra/core/evals';

import { coerce } from './coerce';
import { customScorerId } from './types';

interface CustomScorerRow {
  id: string;
  name: string;
  description: string;
  criteria: string;
  model: string;
}

/**
 * Convert a DB scorer row into a MastraScorer instance.
 * Uses the criteria text as LLM judge instructions with a standard
 * scoring prompt that asks the judge to rate 0.0-1.0.
 */
export function buildCustomScorer(row: CustomScorerRow) {
  return createScorer({
    id: customScorerId(row.id),
    description: row.description,
    judge: {
      model: row.model,
      instructions: row.criteria,
    },
  })
    .generateScore({
      description: `Score based on: ${row.description}`,
      createPrompt: ({ run }) =>
        [
          'Evaluate the following AI response based on the criteria in your instructions.',
          '',
          `User input: ${coerce(run.input)}`,
          `AI response: ${coerce(run.output)}`,
          '',
          'Rate the response from 0.0 (completely fails the criteria) to 1.0 (perfectly meets the criteria).',
          'Respond with ONLY a number between 0.0 and 1.0.',
        ].join('\n'),
    })
    .generateReason({
      description: 'Explain the score',
      createPrompt: ({ run, score }) =>
        [
          'You previously scored the following AI response.',
          '',
          `User input: ${coerce(run.input)}`,
          `AI response: ${coerce(run.output)}`,
          `Score: ${score}`,
          '',
          'Explain in 1-2 sentences why you gave this score based on the criteria in your instructions.',
        ].join('\n'),
    });
}
