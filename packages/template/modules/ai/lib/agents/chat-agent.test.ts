import { describe, expect, it } from 'bun:test';

import { toMastraModelId } from './shared';

describe('toMastraModelId', () => {
  it('passes through provider/model format unchanged', () => {
    expect(toMastraModelId('openai/gpt-5-mini')).toBe('openai/gpt-5-mini');
    expect(toMastraModelId('anthropic/claude-3-5-sonnet')).toBe(
      'anthropic/claude-3-5-sonnet',
    );
    expect(toMastraModelId('google/gemini-2.0-flash')).toBe(
      'google/gemini-2.0-flash',
    );
  });

  it('maps claude-* to anthropic provider', () => {
    expect(toMastraModelId('claude-3-5-sonnet')).toBe(
      'anthropic/claude-3-5-sonnet',
    );
    expect(toMastraModelId('claude-4-opus')).toBe('anthropic/claude-4-opus');
  });

  it('maps gemini-* to google provider', () => {
    expect(toMastraModelId('gemini-2.0-flash')).toBe('google/gemini-2.0-flash');
    expect(toMastraModelId('gemini-pro')).toBe('google/gemini-pro');
  });

  it('maps gpt-* to openai provider', () => {
    expect(toMastraModelId('gpt-5-mini')).toBe('openai/gpt-5-mini');
    expect(toMastraModelId('gpt-4o')).toBe('openai/gpt-4o');
  });

  it('maps o-series models to openai provider', () => {
    expect(toMastraModelId('o1-preview')).toBe('openai/o1-preview');
    expect(toMastraModelId('o3-mini')).toBe('openai/o3-mini');
    expect(toMastraModelId('o4-mini')).toBe('openai/o4-mini');
  });

  it('defaults unknown prefixes to openai with warning', () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(String(args[0]));

    expect(toMastraModelId('mistral-large')).toBe('openai/mistral-large');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Unknown model prefix');

    console.warn = originalWarn;
  });
});
