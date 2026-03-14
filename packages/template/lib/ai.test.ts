import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { getAIConfig, isAIConfigured } from './ai';

describe('getAIConfig()', () => {
  it('returns an AIConfig object', () => {
    const config = getAIConfig();
    expect(config).toHaveProperty('provider');
    expect(config).toHaveProperty('model');
    expect(config).toHaveProperty('embeddingModel');
    expect(config).toHaveProperty('embeddingDimensions');
  });

  it('returns default provider as openai', () => {
    const config = getAIConfig();
    expect(config.provider).toBe('openai');
  });

  it('returns default embedding dimensions as 1536', () => {
    const config = getAIConfig();
    expect(config.embeddingDimensions).toBe(1536);
  });

  it('returns a copy (not the same reference)', () => {
    const a = getAIConfig();
    const b = getAIConfig();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe('isAIConfigured()', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY;
    process.env.GEMINI_API_KEY = originalEnv.GEMINI_API_KEY;
    process.env.ANTHROPIC_API_KEY = originalEnv.ANTHROPIC_API_KEY;
  });

  it('returns false when no API keys are set', () => {
    expect(isAIConfigured()).toBe(false);
  });

  it('returns true when OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(isAIConfigured()).toBe(true);
  });

  it('returns true when GEMINI_API_KEY is set', () => {
    process.env.GEMINI_API_KEY = 'test-key';
    expect(isAIConfigured()).toBe(true);
  });

  it('returns true when ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(isAIConfigured()).toBe(true);
  });
});
