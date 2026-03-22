import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { isAIConfigured } from './ai';

describe('isAIConfigured()', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY;
    process.env.GOOGLE_GENERATIVE_AI_API_KEY =
      originalEnv.GOOGLE_GENERATIVE_AI_API_KEY;
    process.env.ANTHROPIC_API_KEY = originalEnv.ANTHROPIC_API_KEY;
  });

  it('returns false when no API keys are set', () => {
    expect(isAIConfigured()).toBe(false);
  });

  it('returns true when OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(isAIConfigured()).toBe(true);
  });

  it('returns true when GOOGLE_GENERATIVE_AI_API_KEY is set', () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-key';
    expect(isAIConfigured()).toBe(true);
  });

  it('returns true when ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(isAIConfigured()).toBe(true);
  });
});
