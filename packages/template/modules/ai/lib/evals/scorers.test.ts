import { describe, expect, test } from 'bun:test';

test('createScorerSuite returns both scorers with run method', async () => {
  const { createScorerSuite } = await import('./scorers');
  const suite = createScorerSuite();

  expect(suite).toHaveProperty('answerRelevancy');
  expect(suite).toHaveProperty('faithfulness');
  expect(typeof suite.answerRelevancy.run).toBe('function');
  expect(typeof suite.faithfulness.run).toBe('function');
});
