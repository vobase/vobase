import { expect, test } from 'bun:test';

test('scorer registry exports scorers with metadata and run method', async () => {
  const { scorers, getScorerMeta } = await import('./scorers');

  expect(scorers.length).toBeGreaterThanOrEqual(2);

  for (const scorer of scorers) {
    expect(typeof scorer.id).toBe('string');
    expect(typeof scorer.name).toBe('string');
    expect(typeof scorer.description).toBe('string');
    expect(typeof scorer.run).toBe('function');
  }

  const meta = getScorerMeta();
  expect(meta.length).toBe(scorers.length);
  for (const m of meta) {
    expect(m).toHaveProperty('id');
    expect(m).toHaveProperty('name');
    expect(m).toHaveProperty('description');
    expect(m).toHaveProperty('hasJudge');
    expect(m).toHaveProperty('steps');
  }
});
