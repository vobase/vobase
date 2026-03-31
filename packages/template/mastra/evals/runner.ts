import type { MastraScorer } from '@mastra/core/evals';

import { scorers } from './scorers';
import type { EvalItemScore, EvalRunResult } from './types';

/**
 * Run scorers against a set of input/output/context items.
 * Uses each scorer's .run() method with message-based input format.
 *
 * Accepts optional additional scorers (e.g. custom DB-backed ones)
 * that are merged with the code-based registry.
 *
 * Each scorer is an LLM judge call, so this should run in a background job.
 */
export async function runAgentEvals(options: {
  data: Array<{ input: string; output: string; context: string[] }>;
  additionalScorers?: MastraScorer[];
}): Promise<EvalRunResult> {
  const { createAgentTestRun, createTestMessage } = await import(
    '@mastra/evals/scorers/utils'
  );

  const allScorers: MastraScorer[] = [
    ...scorers,
    ...(options.additionalScorers ?? []),
  ];

  const items: EvalItemScore[] = [];

  for (const item of options.data) {
    const scores: Record<string, number | null> = {};

    const testRun = createAgentTestRun({
      inputMessages: [createTestMessage({ content: item.input, role: 'user' })],
      output: [createTestMessage({ content: item.output, role: 'assistant' })],
      systemMessages: item.context.map((ctx) => ({
        role: 'system' as const,
        content: ctx,
      })),
    });

    for (const scorer of allScorers) {
      try {
        const result = await scorer.run({
          input: testRun.input,
          output: testRun.output,
        });
        scores[scorer.id] = result?.score ?? null;
      } catch {
        scores[scorer.id] = null;
      }
    }

    items.push({
      input: item.input,
      output: item.output,
      context: item.context,
      scores,
    });
  }

  // Compute averages per scorer (excluding nulls)
  const averages: Record<string, number | null> = {};
  for (const scorer of allScorers) {
    const vals = items
      .map((i) => i.scores[scorer.id])
      .filter((s): s is number => s !== null);
    averages[scorer.id] = vals.length
      ? vals.reduce((a, b) => a + b, 0) / vals.length
      : null;
  }

  return { items, averages };
}
