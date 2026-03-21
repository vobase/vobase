import { describe, expect, it } from 'bun:test';

import { extractEpisode, extractEventLogs } from './extractors';
import type { MemoryMessage } from './types';

const sampleMessages: MemoryMessage[] = [
  {
    id: '1',
    content: 'Hi, my name is Alice and I need help with my order #12345',
    aiRole: 'user',
    createdAt: new Date(),
  },
  {
    id: '2',
    content: 'Hello Alice! I can help with order #12345. Let me look that up.',
    aiRole: 'assistant',
    createdAt: new Date(),
  },
  {
    id: '3',
    content:
      'It was supposed to arrive yesterday but tracking shows it is stuck in transit.',
    aiRole: 'user',
    createdAt: new Date(),
  },
  {
    id: '4',
    content:
      'I see the issue. Your package is delayed due to weather. Expected delivery is Friday March 21st.',
    aiRole: 'assistant',
    createdAt: new Date(),
  },
];

describe('extractEpisode', () => {
  it('returns an episode with title and content from the mock generate', async () => {
    const mockGenerate = async () => ({
      output: {
        title: 'Order delay inquiry',
        content:
          'The user Alice asked about order #12345 which was delayed in transit. The assistant confirmed weather delays and provided a new delivery estimate of Friday March 21st.',
      },
    });

    const episode = await extractEpisode({
      messages: sampleMessages,
      // biome-ignore lint/suspicious/noExplicitAny: mock doesn't need full generateText signature
      generate: mockGenerate as any,
    });

    expect(episode.title).toBe('Order delay inquiry');
    expect(episode.content).toContain('#12345');
    expect(episode.content).toContain('March 21st');
  });

  it('formats messages as [role]: content for the LLM', async () => {
    let capturedPrompt = '';
    const mockGenerate = async (opts: { prompt: string }) => {
      capturedPrompt = opts.prompt;
      return { output: { title: 'Test', content: 'Test content' } };
    };

    await extractEpisode({
      messages: sampleMessages,
      // biome-ignore lint/suspicious/noExplicitAny: mock doesn't need full generateText signature
      generate: mockGenerate as any,
    });

    expect(capturedPrompt).toContain('[user]: Hi, my name is Alice');
    expect(capturedPrompt).toContain('[assistant]: Hello Alice!');
  });
});

describe('extractEventLogs', () => {
  it('returns facts array from the mock generate', async () => {
    const mockGenerate = async () => ({
      output: {
        facts: [
          { fact: "User's name is Alice.", subject: 'Alice', occurredAt: null },
          {
            fact: 'User has order #12345.',
            subject: 'Alice',
            occurredAt: null,
          },
          {
            fact: 'Order #12345 is delayed due to weather.',
            subject: null,
            occurredAt: null,
          },
          {
            fact: 'Expected delivery is Friday March 21st.',
            subject: null,
            occurredAt: '2026-03-21T00:00:00Z',
          },
        ],
      },
    });

    const facts = await extractEventLogs({
      messages: sampleMessages,
      // biome-ignore lint/suspicious/noExplicitAny: mock doesn't need full generateText signature
      generate: mockGenerate as any,
    });

    expect(facts).toHaveLength(4);
    expect(facts[0].fact).toContain('Alice');
    expect(facts[3].occurredAt).toBe('2026-03-21T00:00:00Z');
  });

  it('handles messages with null content gracefully', async () => {
    const messagesWithNull: MemoryMessage[] = [
      { id: '1', content: null, aiRole: 'user', createdAt: new Date() },
      {
        id: '2',
        content: 'Hello!',
        aiRole: 'assistant',
        createdAt: new Date(),
      },
    ];

    const mockGenerate = async () => ({
      output: { facts: [] },
    });

    const facts = await extractEventLogs({
      messages: messagesWithNull,
      // biome-ignore lint/suspicious/noExplicitAny: mock doesn't need full generateText signature
      generate: mockGenerate as any,
    });

    expect(facts).toEqual([]);
  });
});
