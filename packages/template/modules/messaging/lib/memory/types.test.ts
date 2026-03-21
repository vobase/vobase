import { describe, expect, it } from 'bun:test';

import {
  boundaryResultSchema,
  defaultMemoryConfig,
  episodeSchema,
  eventLogEntrySchema,
  eventLogSchema,
} from './types';

describe('Zod schemas', () => {
  describe('boundaryResultSchema', () => {
    it('parses valid boundary result', () => {
      const result = boundaryResultSchema.parse({
        shouldSplit: true,
        reason: 'Topic changed',
      });
      expect(result.shouldSplit).toBe(true);
    });

    it('rejects missing fields', () => {
      expect(() => boundaryResultSchema.parse({ shouldSplit: true })).toThrow();
    });
  });

  describe('episodeSchema', () => {
    it('parses valid episode', () => {
      const result = episodeSchema.parse({
        title: 'Order inquiry',
        content: 'The user asked about an order.',
      });
      expect(result.title).toBe('Order inquiry');
    });
  });

  describe('eventLogSchema', () => {
    it('parses valid event log with facts array', () => {
      const result = eventLogSchema.parse({
        facts: [
          { fact: 'User is named Alice.', subject: 'Alice', occurredAt: null },
        ],
      });
      expect(result.facts).toHaveLength(1);
    });

    it('accepts empty facts array', () => {
      const result = eventLogSchema.parse({ facts: [] });
      expect(result.facts).toEqual([]);
    });
  });

  describe('eventLogEntrySchema', () => {
    it('accepts nullable subject and occurredAt', () => {
      const result = eventLogEntrySchema.parse({
        fact: 'A fact.',
        subject: null,
        occurredAt: null,
      });
      expect(result.subject).toBeNull();
      expect(result.occurredAt).toBeNull();
    });
  });
});

describe('defaultMemoryConfig', () => {
  it('has expected defaults', () => {
    expect(defaultMemoryConfig.maxTokens).toBe(8192);
    expect(defaultMemoryConfig.maxMessages).toBe(50);
    expect(defaultMemoryConfig.embeddingDimensions).toBe(1536);
  });
});
