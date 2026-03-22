import { describe, expect, it } from 'bun:test';

import {
  computeBufferTokens,
  detectBoundary,
  estimateTokens,
} from './boundary-detector';
import type { MemoryMessage } from './types';

describe('estimateTokens', () => {
  it('estimates ~1 token per 4 characters', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('')).toBe(0);
  });
});

describe('computeBufferTokens', () => {
  it('sums token estimates across messages', () => {
    const messages: MemoryMessage[] = [
      { id: '1', content: 'abcd', aiRole: 'user', createdAt: new Date() },
      {
        id: '2',
        content: 'abcdefgh',
        aiRole: 'assistant',
        createdAt: new Date(),
      },
    ];
    // 'abcd' = 1 token, 'abcdefgh' = 2 tokens
    expect(computeBufferTokens(messages)).toBe(3);
  });

  it('skips null content', () => {
    const messages: MemoryMessage[] = [
      { id: '1', content: null, aiRole: 'user', createdAt: new Date() },
    ];
    expect(computeBufferTokens(messages)).toBe(0);
  });
});

describe('detectBoundary', () => {
  const makeMessages = (count: number): MemoryMessage[] =>
    Array.from({ length: count }, (_, i) => ({
      id: String(i),
      content: `Message ${i}`,
      aiRole: i % 2 === 0 ? 'user' : 'assistant',
      createdAt: new Date(Date.now() + i * 1000),
    }));

  it('returns shouldSplit=false when fewer than 4 messages', async () => {
    const result = await detectBoundary({ messages: makeMessages(3) });
    expect(result.shouldSplit).toBe(false);
    expect(result.reason).toContain('Not enough messages');
  });

  it('force-splits when token limit is exceeded', async () => {
    const longContent = 'x'.repeat(40_000); // ~10,000 tokens
    const messages: MemoryMessage[] = [
      { id: '1', content: longContent, aiRole: 'user', createdAt: new Date() },
    ];
    const result = await detectBoundary({
      messages,
      config: { maxTokens: 5000 },
    });
    expect(result.shouldSplit).toBe(true);
    expect(result.reason).toContain('Token limit');
  });

  it('force-splits when message limit is exceeded', async () => {
    const result = await detectBoundary({
      messages: makeMessages(10),
      config: { maxMessages: 5 },
    });
    expect(result.shouldSplit).toBe(true);
    expect(result.reason).toContain('Message limit');
  });

  it('uses the generate override for LLM-based detection', async () => {
    const mockGenerate = async () => ({
      object: { shouldSplit: true, reason: 'Topic changed to weather' },
    });

    const result = await detectBoundary({
      messages: makeMessages(6),
      // biome-ignore lint/suspicious/noExplicitAny: mock doesn't need full generateText signature
      generate: mockGenerate as any,
    });
    expect(result.shouldSplit).toBe(true);
    expect(result.reason).toContain('weather');
  });

  it('returns shouldSplit=false on LLM error', async () => {
    const failingGenerate = async () => {
      throw new Error('API down');
    };

    const result = await detectBoundary({
      messages: makeMessages(6),
      // biome-ignore lint/suspicious/noExplicitAny: mock doesn't need full generateText signature
      generate: failingGenerate as any,
    });
    expect(result.shouldSplit).toBe(false);
    expect(result.reason).toContain('LLM error');
  });
});
