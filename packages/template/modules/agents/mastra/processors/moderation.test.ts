import { describe, expect, test } from 'bun:test';

import {
  createModerationProcessor,
  extractText,
  MODERATION_NOTICE,
  type ModerationBlockInfo,
} from './moderation';

/** Build a minimal MastraDBMessage-compatible object for testing. */
function msg(role: string, text: string) {
  return {
    id: 'test-id',
    role,
    content: { format: 2, parts: [{ type: 'text', text }] },
    createdAt: new Date(),
  };
}

/** Extract text from result message content. */
function getText(result: unknown[]): string {
  const m = result[result.length - 1] as { content: unknown };
  return extractText(m.content);
}

/** Mock abort that throws like the real TripWire. */
class TripWireError extends Error {
  constructor(
    public reason: string,
    public options?: { retry?: boolean; metadata?: unknown },
  ) {
    super(reason);
  }
}

function mockAbort(
  reason?: string,
  options?: { retry?: boolean; metadata?: unknown },
): never {
  throw new TripWireError(reason ?? 'abort', options);
}

// biome-ignore lint/suspicious/noExplicitAny: test mock for Mastra processor types
function makeArgs(messages: any[], overrides: Record<string, unknown> = {}) {
  return {
    messages,
    messageList: { messages },
    systemMessages: [],
    state: {},
    abort: mockAbort as never,
    retryCount: 0,
    ...overrides,
    // biome-ignore lint/suspicious/noExplicitAny: test mock for Mastra processor types
  } as any;
}

describe('createModerationProcessor', () => {
  test('passes clean input unchanged', async () => {
    const processor = createModerationProcessor({ blocklist: ['badword'] });
    const messages = [msg('user', 'Hello, how are you?')];
    const result = await processor.processInput?.(makeArgs(messages));
    const resultMsgs = Array.isArray(result) ? result : [];
    expect(resultMsgs).toHaveLength(1);
    expect(getText(resultMsgs)).toBe('Hello, how are you?');
  });

  test('abort (TripWire) is triggered on first attempt for blocked content', async () => {
    const processor = createModerationProcessor({ blocklist: ['forbidden'] });
    const messages = [msg('user', 'This is forbidden content')];

    try {
      await processor.processInput?.(makeArgs(messages));
      expect(true).toBe(false); // Should not reach here
    } catch (err) {
      expect(err).toBeInstanceOf(TripWireError);
      expect((err as TripWireError).options?.retry).toBe(true);
      expect((err as TripWireError).options?.metadata).toEqual({
        reason: 'blocklist',
        matchedTerm: 'forbidden',
      });
    }
  });

  test('on retry (retryCount > 0), replaces content with moderation notice', async () => {
    const processor = createModerationProcessor({ blocklist: ['forbidden'] });
    const messages = [msg('user', 'This is forbidden content')];
    const result = await processor.processInput?.(
      makeArgs(messages, { retryCount: 1 }),
    );
    const resultMsgs = Array.isArray(result) ? result : [];
    expect(getText(resultMsgs)).toBe(MODERATION_NOTICE);
  });

  test('blocklist matching is case-insensitive', async () => {
    const processor = createModerationProcessor({ blocklist: ['blocked'] });
    const messages = [msg('user', 'BLOCKED content here')];
    // On retry, content is replaced
    const result = await processor.processInput?.(
      makeArgs(messages, { retryCount: 1 }),
    );
    const resultMsgs = Array.isArray(result) ? result : [];
    expect(getText(resultMsgs)).toBe(MODERATION_NOTICE);
  });

  test('enforces maxLength via TripWire', async () => {
    const processor = createModerationProcessor({ maxLength: 10 });
    const messages = [
      msg('user', 'This message is way too long for the limit'),
    ];

    try {
      await processor.processInput?.(makeArgs(messages));
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TripWireError);
      expect((err as TripWireError).options?.retry).toBe(true);
    }
  });

  test('maxLength retry replaces content', async () => {
    const processor = createModerationProcessor({ maxLength: 10 });
    const messages = [
      msg('user', 'This message is way too long for the limit'),
    ];
    const result = await processor.processInput?.(
      makeArgs(messages, { retryCount: 1 }),
    );
    const resultMsgs = Array.isArray(result) ? result : [];
    expect(getText(resultMsgs)).toBe(MODERATION_NOTICE);
  });

  test('does not modify non-user messages', async () => {
    const processor = createModerationProcessor({ blocklist: ['forbidden'] });
    const messages = [msg('assistant', 'This is forbidden but from assistant')];
    const result = await processor.processInput?.(makeArgs(messages));
    const resultMsgs = Array.isArray(result) ? result : [];
    expect(getText(resultMsgs)).toBe('This is forbidden but from assistant');
  });

  test('preserves earlier messages on retry', async () => {
    const processor = createModerationProcessor({ blocklist: ['badword'] });
    const messages = [msg('assistant', 'Hello!'), msg('user', 'badword here')];
    const result = await processor.processInput?.(
      makeArgs(messages, { retryCount: 1 }),
    );
    const resultMsgs = Array.isArray(result) ? result : [];
    expect(resultMsgs).toHaveLength(2);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    expect(extractText((resultMsgs[0] as any).content)).toBe('Hello!');
    expect(getText(resultMsgs)).toBe(MODERATION_NOTICE);
  });
});

describe('onBlock callback', () => {
  test('calls onBlock with reason=blocklist and matched term', async () => {
    const calls: ModerationBlockInfo[] = [];
    const processor = createModerationProcessor(
      { blocklist: ['forbidden', 'blocked'] },
      (info) => calls.push(info),
    );
    const messages = [msg('user', 'This is forbidden content')];
    try {
      await processor.processInput?.(makeArgs(messages));
    } catch {
      // Expected TripWire
    }
    expect(calls).toHaveLength(1);
    expect(calls[0].reason).toBe('blocklist');
    expect(calls[0].matchedTerm).toBe('forbidden');
    expect(calls[0].content).toBe('This is forbidden content');
  });

  test('calls onBlock with reason=max_length', async () => {
    const calls: ModerationBlockInfo[] = [];
    const processor = createModerationProcessor({ maxLength: 5 }, (info) =>
      calls.push(info),
    );
    const messages = [msg('user', 'This is too long')];
    try {
      await processor.processInput?.(makeArgs(messages));
    } catch {
      // Expected TripWire
    }
    expect(calls).toHaveLength(1);
    expect(calls[0].reason).toBe('max_length');
    expect(calls[0].matchedTerm).toBeUndefined();
  });

  test('does not call onBlock when message passes', async () => {
    const calls: ModerationBlockInfo[] = [];
    const processor = createModerationProcessor(
      { blocklist: ['badword'] },
      (info) => calls.push(info),
    );
    const messages = [msg('user', 'Hello, this is fine')];
    await processor.processInput?.(makeArgs(messages));
    expect(calls).toHaveLength(0);
  });

  test('works without onBlock callback', async () => {
    const processor = createModerationProcessor({ blocklist: ['bad'] });
    const messages = [msg('user', 'bad content')];
    // First call triggers TripWire
    try {
      await processor.processInput?.(makeArgs(messages));
    } catch {
      // Expected
    }
    // Retry replaces content
    const result = await processor.processInput?.(
      makeArgs(messages, { retryCount: 1 }),
    );
    const resultMsgs = Array.isArray(result) ? result : [];
    expect(getText(resultMsgs)).toBe(MODERATION_NOTICE);
  });

  test('onBlock error does not prevent TripWire', async () => {
    const processor = createModerationProcessor({ blocklist: ['bad'] }, () => {
      throw new Error('DB insert failed');
    });
    const messages = [msg('user', 'bad content')];
    try {
      await processor.processInput?.(makeArgs(messages));
      expect(true).toBe(false);
    } catch (err) {
      // Should be TripWire, not the DB error
      expect(err).toBeInstanceOf(TripWireError);
    }
  });
});
