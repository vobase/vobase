import {
  createAnswerRelevancyScorer,
  createFaithfulnessScorer,
} from '@mastra/evals/scorers/prebuilt';

import { models } from '../lib/models';

/**
 * Scorer registry — all available eval scorers.
 *
 * Each scorer is a MastraScorer instance with id, name, description.
 * The runner iterates this registry dynamically, so adding a new scorer
 * here automatically flows through to eval runs and the dashboard.
 *
 * To add a custom scorer:
 *   import { createScorer } from '@mastra/core/evals';
 *   const myScorer = createScorer({ id: 'my-scorer', description: '...' })
 *     .generateScore(({ run }) => { ... });
 *   Then add it to the `scorers` array below.
 */

const answerRelevancy = createAnswerRelevancyScorer({
  model: models.gpt_mini,
});

const faithfulness = createFaithfulnessScorer({
  model: models.gpt_mini,
});

/** All registered scorers. The runner uses this list. */
export const scorers = [answerRelevancy, faithfulness] as const;

/** Scorer metadata for the dashboard API. */
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

/** Look up a scorer by id. */
export function getScorer(id: string) {
  return scorers.find((s) => s.id === id);
}

/** Load enabled custom scorers from DB and convert to MastraScorer instances. */
export async function getActiveCustomScorers(db: { select: () => any }) {
  const { eq } = await import('drizzle-orm');
  const { aiScorers } = await import('../../modules/ai/schema');
  const { buildCustomScorer } = await import('./custom-scorer-factory');

  const rows = await db
    .select()
    .from(aiScorers)
    .where(eq(aiScorers.enabled, true));
  return rows.map(buildCustomScorer);
}
