import {
  createAnswerRelevancyScorer,
  createFaithfulnessScorer,
} from '@mastra/evals/scorers/prebuilt';
import type { VobaseDb } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { aiScorers } from '../../modules/ai/schema';
import { models } from '../lib/models';
import { buildCustomScorer } from './custom-scorer-factory';

/**
 * Scorer registry — all code-based eval scorers.
 *
 * Adding a new scorer here automatically flows through to eval runs,
 * the Mastra instance, and the dashboard.
 */

const answerRelevancy = createAnswerRelevancyScorer({
  model: models.gpt_mini,
});

const faithfulness = createFaithfulnessScorer({
  model: models.gpt_mini,
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

export function getScorer(id: string) {
  return scorers.find((s) => s.id === id);
}

/** Load enabled custom scorers from DB and convert to MastraScorer instances. */
export async function getActiveCustomScorers(db: VobaseDb) {
  const rows = await db
    .select()
    .from(aiScorers)
    .where(eq(aiScorers.enabled, true));
  return rows.map(buildCustomScorer);
}
