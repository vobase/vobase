import { describe, expect, mock, test } from 'bun:test';

// Mock getAIConfig before importing scorers
mock.module('../../../../lib/ai', () => ({
  getAIConfig: () => ({
    provider: 'openai',
    model: 'gpt-5-mini',
    embeddingModel: 'text-embedding-3-small',
    embeddingDimensions: 1536,
  }),
}));

test('createScorerSuite returns both scorers with run method', async () => {
  const { createScorerSuite } = await import('./scorers');
  const suite = createScorerSuite();

  expect(suite).toHaveProperty('answerRelevancy');
  expect(suite).toHaveProperty('faithfulness');
  expect(typeof suite.answerRelevancy.run).toBe('function');
  expect(typeof suite.faithfulness.run).toBe('function');
});
