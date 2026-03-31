import type { MastraScorer } from '@mastra/core/evals';

import { scorers } from './scorers';
import type { EvalItemScore, EvalRunResult } from './types';

/**
 * Run scorers against a set of input/output/context items.
 * Scorers within each item run concurrently (independent LLM judge calls).
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
    const testRun = createAgentTestRun({
      inputMessages: [createTestMessage({ content: item.input, role: 'user' })],
      output: [createTestMessage({ content: item.output, role: 'assistant' })],
      systemMessages: item.context.map((ctx) => ({
        role: 'system' as const,
        content: ctx,
      })),
    });

    // Run all scorers concurrently for this item
    const results = await Promise.all(
      allScorers.map(async (scorer) => {
        try {
          const r = await scorer.run({
            input: testRun.input,
            output: testRun.output,
          });
          return [scorer.id, r?.score ?? null] as const;
        } catch {
          return [scorer.id, null] as const;
        }
      }),
    );

    items.push({
      input: item.input,
      output: item.output,
      context: item.context,
      scores: Object.fromEntries(results),
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
