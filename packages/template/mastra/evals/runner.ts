import { createScorerSuite } from './scorers';
import type { EvalItemScore, EvalRunResult } from './types';

/**
 * Run eval scorers against a set of input/output/context items.
 * Uses the scorer's .run() method with message-based input format.
 *
 * Each scorer is an LLM judge call, so this should run in a background job.
 */
export async function runAgentEvals(options: {
  data: Array<{ input: string; output: string; context: string[] }>;
}): Promise<EvalRunResult> {
  const scorers = createScorerSuite();
  const { createAgentTestRun, createTestMessage } = await import(
    '@mastra/evals/scorers/utils'
  );

  const items: EvalItemScore[] = [];

  for (const item of options.data) {
    let answerRelevancy: number | null = null;
    let faithfulness: number | null = null;

    // Convert simple string format to Mastra's message-based scorer input
    const testRun = createAgentTestRun({
      inputMessages: [createTestMessage({ content: item.input, role: 'user' })],
      output: [createTestMessage({ content: item.output, role: 'assistant' })],
      systemMessages: item.context.map((ctx) => ({
        role: 'system' as const,
        content: ctx,
      })),
    });

    try {
      const relevancyResult = await scorers.answerRelevancy.run({
        input: testRun.input,
        output: testRun.output,
      });
      answerRelevancy = relevancyResult?.score ?? null;
    } catch {
      // Scorer failure for this item — record null
    }

    try {
      const faithfulnessResult = await scorers.faithfulness.run({
        input: testRun.input,
        output: testRun.output,
      });
      faithfulness = faithfulnessResult?.score ?? null;
    } catch {
      // Scorer failure for this item — record null
    }

    items.push({
      input: item.input,
      output: item.output,
      context: item.context,
      scores: { answerRelevancy, faithfulness },
    });
  }

  // Compute averages (excluding nulls)
  const relevancyScores = items
    .map((i) => i.scores.answerRelevancy)
    .filter((s): s is number => s !== null);
  const faithfulnessScores = items
    .map((i) => i.scores.faithfulness)
    .filter((s): s is number => s !== null);

  return {
    items,
    averages: {
      answerRelevancy: relevancyScores.length
        ? relevancyScores.reduce((a, b) => a + b, 0) / relevancyScores.length
        : null,
      faithfulness: faithfulnessScores.length
        ? faithfulnessScores.reduce((a, b) => a + b, 0) /
          faithfulnessScores.length
        : null,
    },
  };
}
