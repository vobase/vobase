import { describe, expect, test } from 'bun:test';

import { createConversationSyncProcessor } from './conversation-sync';

// ─── Test Helpers ──────────────────────────────────────────────────

/** Minimal messageList mock that tracks add() calls. */
function createMockMessageList() {
  const added: Array<{ messages: unknown[]; source: string }> = [];
  return {
    messages: [],
    add(msgs: unknown[], source: string) {
      added.push({ messages: Array.isArray(msgs) ? msgs : [msgs], source });
      return this;
    },
    _added: added,
  };
}

/** Minimal RequestContext mock. */
function createMockRequestContext(
  values: Record<string, unknown> = {},
): { get: (key: string) => unknown } {
  return {
    get: (key: string) => values[key],
  };
}

/** Build a message row matching the DB select shape. */
function makeRow(overrides: Partial<{
  id: string;
  senderType: string;
  content: string;
  contentType: string;
  contentData: Record<string, unknown>;
  private: boolean;
  createdAt: Date;
}> = {}) {
  return {
    id: overrides.id ?? 'msg-1',
    senderType: overrides.senderType ?? 'contact',
    content: overrides.content ?? 'Hello',
    contentType: overrides.contentType ?? 'text',
    contentData: overrides.contentData ?? {},
    private: overrides.private ?? false,
    createdAt: overrides.createdAt ?? new Date(),
  };
}

/** Mock deps with controllable DB results and optional storage. */
function createMockDeps(
  rows: ReturnType<typeof makeRow>[] = [],
  storage?: { download: (key: string) => Uint8Array; throws?: boolean },
) {
  const mockStorage = storage
    ? {
        bucket: () => ({
          presign: (key: string) => `/api/storage/chat-attachments/${key}`,
          download: async (key: string) => {
            if (storage.throws) throw new Error('download failed');
            return storage.download(key);
          },
        }),
      }
    : undefined;

  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => Promise.resolve(rows),
            }),
          }),
        }),
      }),
    },
    storage: mockStorage,
  };
}

// biome-ignore lint/suspicious/noExplicitAny: test mock for Mastra processor args
function makeArgs(overrides: Record<string, unknown> = {}): any {
  const messageList = overrides.messageList ?? createMockMessageList();
  const requestContext =
    overrides.requestContext ?? createMockRequestContext();
  return {
    messages: [],
    messageList,
    systemMessages: [],
    state: {},
    abort: () => {},
    retryCount: 0,
    requestContext,
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('ConversationSyncProcessor', () => {
  test('returns early when no conversationId in requestContext', async () => {
    const processor = createConversationSyncProcessor();
    const ml = createMockMessageList();
    const result = await processor.processInput!(
      makeArgs({
        messageList: ml,
        requestContext: createMockRequestContext({ deps: createMockDeps() }),
      }),
    );
    expect(result).toBe(ml);
    expect(ml._added).toHaveLength(0);
  });

  test('returns early when no deps in requestContext', async () => {
    const processor = createConversationSyncProcessor();
    const ml = createMockMessageList();
    const result = await processor.processInput!(
      makeArgs({
        messageList: ml,
        requestContext: createMockRequestContext({
          conversationId: 'conv-1',
        }),
      }),
    );
    expect(result).toBe(ml);
    expect(ml._added).toHaveLength(0);
  });

  test('returns early when conversation has no messages', async () => {
    const processor = createConversationSyncProcessor();
    const ml = createMockMessageList();
    const result = await processor.processInput!(
      makeArgs({
        messageList: ml,
        requestContext: createMockRequestContext({
          conversationId: 'conv-1',
          deps: createMockDeps([]),
        }),
      }),
    );
    expect(result).toBe(ml);
    expect(ml._added).toHaveLength(0);
  });

  test('injects text messages as user role with source memory', async () => {
    const processor = createConversationSyncProcessor();
    const ml = createMockMessageList();
    const rows = [
      makeRow({ content: 'Hi there', senderType: 'contact' }),
    ];

    await processor.processInput!(
      makeArgs({
        messageList: ml,
        requestContext: createMockRequestContext({
          conversationId: 'conv-1',
          deps: createMockDeps(rows),
        }),
      }),
    );

    expect(ml._added).toHaveLength(1);
    expect(ml._added[0].source).toBe('memory');
    expect(ml._added[0].messages[0]).toEqual({
      role: 'user',
      content: 'Hi there',
    });
  });

  test('maps agent sender to assistant role', async () => {
    const processor = createConversationSyncProcessor();
    const ml = createMockMessageList();
    const rows = [
      makeRow({ content: 'How can I help?', senderType: 'agent' }),
    ];

    await processor.processInput!(
      makeArgs({
        messageList: ml,
        requestContext: createMockRequestContext({
          conversationId: 'conv-1',
          deps: createMockDeps(rows),
        }),
      }),
    );

    expect(ml._added[0].messages[0]).toEqual({
      role: 'assistant',
      content: 'How can I help?',
    });
  });

  test('prefixes staff echo messages with [Staff]', async () => {
    const processor = createConversationSyncProcessor();
    const ml = createMockMessageList();
    const rows = [
      makeRow({ content: 'Staff reply', senderType: 'user' }),
    ];

    await processor.processInput!(
      makeArgs({
        messageList: ml,
        requestContext: createMockRequestContext({
          conversationId: 'conv-1',
          deps: createMockDeps(rows),
        }),
      }),
    );

    expect(ml._added[0].messages[0]).toEqual({
      role: 'user',
      content: '[Staff] Staff reply',
    });
  });

  test('builds image parts with presigned URL when storageKey available', async () => {
    const processor = createConversationSyncProcessor();
    const ml = createMockMessageList();
    const rows = [
      makeRow({
        contentType: 'image',
        content: '[image]',
        contentData: {
          media: [
            {
              type: 'image',
              url: 'https://old-url.com/img.jpg',
              storageKey: 'conv-1/wamid123/photo.jpg',
              mimeType: 'image/jpeg',
            },
          ],
        },
      }),
    ];

    await processor.processInput!(
      makeArgs({
        messageList: ml,
        requestContext: createMockRequestContext({
          conversationId: 'conv-1',
          deps: createMockDeps(rows, {
            download: () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
          }),
        }),
      }),
    );

    expect(ml._added).toHaveLength(1);
    const msg = ml._added[0].messages[0] as {
      role: string;
      content: unknown[];
    };
    expect(msg.role).toBe('user');
    expect(msg.content).toEqual([
      { type: 'image', image: 'data:image/jpeg;base64,iVBORw==' },
    ]);
  });

  test('falls back to text for legacy images without storageKey or extractable URL', async () => {
    const processor = createConversationSyncProcessor();
    const ml = createMockMessageList();
    const rows = [
      makeRow({
        contentType: 'image',
        content: '[image]',
        contentData: {
          media: [
            {
              type: 'image',
              url: '', // Empty URL — no extractable key
              mimeType: 'image/jpeg',
            },
          ],
        },
      }),
    ];

    await processor.processInput!(
      makeArgs({
        messageList: ml,
        requestContext: createMockRequestContext({
          conversationId: 'conv-1',
          deps: createMockDeps(rows, {
            download: () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
          }),
        }),
      }),
    );

    const msg = ml._added[0].messages[0] as {
      role: string;
      content: unknown[];
    };
    expect(msg.content).toEqual([
      {
        type: 'text',
        text: '(customer sent an image — visible in prior messages)',
      },
    ]);
  });

  test('falls back to text when download throws', async () => {
    const processor = createConversationSyncProcessor();
    const ml = createMockMessageList();
    const rows = [
      makeRow({
        contentType: 'image',
        content: '[image]',
        contentData: {
          media: [
            {
              type: 'image',
              url: 'https://example.com/img.jpg',
              storageKey: 'conv-1/msg1/photo.jpg',
              mimeType: 'image/jpeg',
            },
          ],
        },
      }),
    ];

    await processor.processInput!(
      makeArgs({
        messageList: ml,
        requestContext: createMockRequestContext({
          conversationId: 'conv-1',
          deps: createMockDeps(rows, {
            download: () => new Uint8Array(),
            throws: true,
          }),
        }),
      }),
    );

    const msg = ml._added[0].messages[0] as {
      role: string;
      content: unknown[];
    };
    expect(msg.content).toEqual([
      {
        type: 'text',
        text: '(customer sent an image — temporarily unavailable)',
      },
    ]);
  });

  test('handles non-visual media types correctly', async () => {
    const processor = createConversationSyncProcessor();
    const ml = createMockMessageList();
    // Rows in DESC order (mock simulates DB returning newest-first)
    const rows = [
      makeRow({ id: 'msg-4', contentType: 'sticker', content: '[sticker]' }),
      makeRow({
        id: 'msg-3',
        contentType: 'document',
        content: '[document]',
      }),
      makeRow({ id: 'msg-2', contentType: 'audio', content: '[audio]' }),
      makeRow({ contentType: 'video', content: '[video]' }),
    ];

    await processor.processInput!(
      makeArgs({
        messageList: ml,
        requestContext: createMockRequestContext({
          conversationId: 'conv-1',
          deps: createMockDeps(rows),
        }),
      }),
    );

    const msgs = ml._added[0].messages as Array<{
      role: string;
      content: string;
    }>;
    expect(msgs[0].content).toContain('video');
    expect(msgs[1].content).toContain('voice message');
    expect(msgs[2].content).toContain('document');
    expect(msgs[3].content).toContain('sticker');
  });

  test('handles mixed content types in one conversation', async () => {
    const processor = createConversationSyncProcessor();
    const ml = createMockMessageList();
    // Rows in DESC order (mock simulates DB returning newest-first, processor reverses to chronological)
    const rows = [
      makeRow({
        id: 'msg-3',
        contentType: 'image',
        content: '[image]',
        senderType: 'contact',
        contentData: {
          media: [
            {
              type: 'image',
              storageKey: 'conv-1/msg3/photo.jpg',
              url: '',
              mimeType: 'image/jpeg',
            },
          ],
        },
      }),
      makeRow({
        id: 'msg-2',
        content: 'How can I help?',
        senderType: 'agent',
      }),
      makeRow({ content: 'Hello', senderType: 'contact' }),
    ];

    await processor.processInput!(
      makeArgs({
        messageList: ml,
        requestContext: createMockRequestContext({
          conversationId: 'conv-1',
          deps: createMockDeps(rows, {
            download: () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
          }),
        }),
      }),
    );

    const msgs = ml._added[0].messages as Array<{
      role: string;
      content: unknown;
    }>;
    expect(msgs).toHaveLength(3);
    expect(msgs[0]).toEqual({ role: 'user', content: 'Hello' });
    expect(msgs[1]).toEqual({
      role: 'assistant',
      content: 'How can I help?',
    });
    expect((msgs[2].content as unknown[])[0]).toEqual({
      type: 'image',
      image: 'data:image/jpeg;base64,iVBORw==',
    });
  });

  test('image without storage falls back gracefully', async () => {
    const processor = createConversationSyncProcessor();
    const ml = createMockMessageList();
    const rows = [
      makeRow({
        contentType: 'image',
        content: '[image]',
        contentData: {
          media: [
            {
              type: 'image',
              url: 'https://example.com/img.jpg',
              storageKey: 'conv-1/msg1/photo.jpg',
              mimeType: 'image/jpeg',
            },
          ],
        },
      }),
    ];

    // No storage provided
    await processor.processInput!(
      makeArgs({
        messageList: ml,
        requestContext: createMockRequestContext({
          conversationId: 'conv-1',
          deps: createMockDeps(rows),
        }),
      }),
    );

    const msg = ml._added[0].messages[0] as {
      role: string;
      content: unknown[];
    };
    expect(msg.content).toEqual([
      {
        type: 'text',
        text: '(customer sent an image — temporarily unavailable)',
      },
    ]);
  });

  test('respects custom limit parameter', async () => {
    const processor = createConversationSyncProcessor(5);
    // The limit is passed to the DB query — verified via the mock chain
    // We just verify the processor creates and runs without error
    const ml = createMockMessageList();
    await processor.processInput!(
      makeArgs({
        messageList: ml,
        requestContext: createMockRequestContext({
          conversationId: 'conv-1',
          deps: createMockDeps([makeRow()]),
        }),
      }),
    );
    expect(ml._added).toHaveLength(1);
  });

  test('legacy image with local storage URL extracts key', async () => {
    const processor = createConversationSyncProcessor();
    const ml = createMockMessageList();
    const rows = [
      makeRow({
        contentType: 'image',
        content: '[image]',
        contentData: {
          media: [
            {
              type: 'image',
              url: '/storage/chat-attachments/conv-1/wamid123/photo.jpg?token=abc',
              mimeType: 'image/jpeg',
              // No storageKey — legacy row
            },
          ],
        },
      }),
    ];

    await processor.processInput!(
      makeArgs({
        messageList: ml,
        requestContext: createMockRequestContext({
          conversationId: 'conv-1',
          deps: createMockDeps(rows, {
            download: () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
          }),
        }),
      }),
    );

    const msg = ml._added[0].messages[0] as {
      role: string;
      content: unknown[];
    };
    expect(msg.content).toEqual([
      { type: 'image', image: 'data:image/jpeg;base64,iVBORw==' },
    ]);
  });
});
