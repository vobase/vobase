import { describe, expect, it, mock } from 'bun:test';

import { materializeMessages } from './materialize-messages';

// ─── Helpers ─────────────────────────────────────────────────────────

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg_001',
    senderType: 'contact',
    senderId: 'contact_1',
    content: 'Hello',
    contentType: 'text',
    caption: null,
    createdAt: new Date('2026-04-15T14:28:00Z'),
    ...overrides,
  };
}

/**
 * Build a mock db that returns canned messages and conversation meta.
 * Uses a chainable query builder pattern matching Drizzle's API.
 */
function mockDb(
  messageRows: ReturnType<typeof makeMessage>[],
  meta: { channelType: string; status: string; assignee: string } | null = {
    channelType: 'whatsapp',
    status: 'active',
    assignee: 'agent:booking',
  },
) {
  let callIndex = 0;

  const createChain = (result: unknown) => {
    const chain: Record<string, unknown> = {};
    const methods = ['from', 'innerJoin', 'where', 'orderBy', 'limit'];
    for (const method of methods) {
      chain[method] = mock(() => chain);
    }
    // Terminal — returns the result when awaited
    // biome-ignore lint/suspicious/noThenProperty: mock needs thenable for await
    chain.then = (resolve: (v: unknown) => void) => resolve(result);
    return chain;
  };

  return {
    select: mock(() => {
      const idx = callIndex++;
      if (idx === 0) {
        // First select: messages query
        return createChain([...messageRows].reverse());
      }
      // Second select: conversation meta
      return createChain(meta ? [meta] : []);
    }),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('materializeMessages', () => {
  it('formats a basic text conversation', async () => {
    const msgs = [
      makeMessage({
        id: 'msg_001',
        senderType: 'contact',
        content: "Hi, I'd like to book an appointment",
        createdAt: new Date('2026-04-15T14:28:00Z'),
      }),
      makeMessage({
        id: 'msg_002',
        senderType: 'agent',
        senderId: 'agent:booking',
        content: 'Of course! What service are you looking for?',
        createdAt: new Date('2026-04-15T14:28:30Z'),
      }),
    ];

    const result = await materializeMessages(
      mockDb(msgs) as never,
      'conv_abc123',
    );

    expect(result).toContain('# Conversation conv_abc123');
    expect(result).toContain(
      'Channel: whatsapp | Status: active | Assignee: agent:booking',
    );
    expect(result).toContain('[2026-04-15 14:28] Customer:');
    expect(result).toContain("Hi, I'd like to book an appointment");
    expect(result).toContain('[2026-04-15 14:28] You:');
    expect(result).toContain('Of course! What service are you looking for?');
    expect(result).toContain('(2 messages shown)');
  });

  it('handles empty conversations', async () => {
    const result = await materializeMessages(mockDb([]) as never, 'conv_empty');

    expect(result).toContain('# Conversation conv_empty');
    expect(result).toContain('(no messages yet)');
  });

  it('formats image with caption', async () => {
    const msgs = [
      makeMessage({
        contentType: 'image',
        content: '',
        caption: 'My rash on left arm',
      }),
    ];

    const result = await materializeMessages(mockDb(msgs) as never, 'conv_img');

    expect(result).toContain('[Image] My rash on left arm');
  });

  it('formats image without caption', async () => {
    const msgs = [
      makeMessage({
        contentType: 'image',
        content: '',
        caption: null,
      }),
    ];

    const result = await materializeMessages(
      mockDb(msgs) as never,
      'conv_img2',
    );

    expect(result).toContain('[Image]');
    expect(result).not.toContain('[Image] ');
  });

  it('formats video with and without caption', async () => {
    const msgs = [
      makeMessage({ contentType: 'video', content: '', caption: 'Demo video' }),
      makeMessage({
        id: 'msg_002',
        contentType: 'video',
        content: '',
        caption: null,
        createdAt: new Date('2026-04-15T14:29:00Z'),
      }),
    ];

    const result = await materializeMessages(mockDb(msgs) as never, 'conv_vid');

    expect(result).toContain('Demo video');
    expect(result).toContain('(customer sent a video)');
  });

  it('formats audio with and without caption', async () => {
    const msgs = [
      makeMessage({
        contentType: 'audio',
        content: '',
        caption: 'Transcribed: I need help',
      }),
      makeMessage({
        id: 'msg_002',
        contentType: 'audio',
        content: '',
        caption: null,
        createdAt: new Date('2026-04-15T14:29:00Z'),
      }),
    ];

    const result = await materializeMessages(
      mockDb(msgs) as never,
      'conv_audio',
    );

    expect(result).toContain('Transcribed: I need help');
    expect(result).toContain('(customer sent a voice message)');
  });

  it('formats document with and without caption', async () => {
    const msgs = [
      makeMessage({
        contentType: 'document',
        content: '',
        caption: 'Invoice.pdf',
      }),
      makeMessage({
        id: 'msg_002',
        contentType: 'document',
        content: '',
        caption: null,
        createdAt: new Date('2026-04-15T14:29:00Z'),
      }),
    ];

    const result = await materializeMessages(mockDb(msgs) as never, 'conv_doc');

    expect(result).toContain('[Document] Invoice.pdf');
    expect(result).toContain('(customer sent a document)');
  });

  it('formats sticker', async () => {
    const msgs = [makeMessage({ contentType: 'sticker', content: '' })];

    const result = await materializeMessages(
      mockDb(msgs) as never,
      'conv_sticker',
    );

    expect(result).toContain('(customer sent a sticker)');
  });

  it('prefixes staff messages with [Staff]', async () => {
    const msgs = [
      makeMessage({
        senderType: 'user',
        senderId: 'user_jane',
        content: 'Let me check that for you',
      }),
    ];

    const result = await materializeMessages(
      mockDb(msgs) as never,
      'conv_staff',
    );

    expect(result).toContain('[Staff] user_jane:');
    expect(result).toContain('Let me check that for you');
  });

  it('shows footer with limit note when at capacity', async () => {
    const msgs = Array.from({ length: 5 }, (_, i) =>
      makeMessage({
        id: `msg_${String(i).padStart(3, '0')}`,
        content: `Message ${i}`,
        createdAt: new Date(Date.UTC(2026, 3, 15, 14, 28 + i)),
      }),
    );

    const result = await materializeMessages(
      mockDb(msgs) as never,
      'conv_full',
      5, // limit = 5, matches row count
    );

    expect(result).toContain(
      "(5 messages shown. Use 'vobase recall <query>' for older history.)",
    );
  });

  it('handles missing conversation meta gracefully', async () => {
    const msgs = [makeMessage()];

    const result = await materializeMessages(
      mockDb(msgs, null) as never,
      'conv_no_meta',
    );

    expect(result).toContain(
      'Channel: unknown | Status: unknown | Assignee: unassigned',
    );
  });

  it('formats interactive content type same as text', async () => {
    const msgs = [
      makeMessage({
        contentType: 'interactive',
        content: 'Option A selected',
      }),
    ];

    const result = await materializeMessages(
      mockDb(msgs) as never,
      'conv_interactive',
    );

    expect(result).toContain('Option A selected');
  });
});
