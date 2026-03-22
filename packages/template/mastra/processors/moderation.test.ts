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

describe('createModerationProcessor', () => {
  test('passes clean input unchanged', async () => {
    const processor = createModerationProcessor({ blocklist: ['badword'] });
    const messages = [msg('user', 'Hello, how are you?')];
    const result = await processor.processInput!({
      messages: messages as any,
      messageList: { messages } as any,
      systemMessages: [],
      state: {},
      abort: (() => {}) as never,
      retryCount: 0,
    } as any);
    const resultMsgs = Array.isArray(result) ? result : [];
    expect(resultMsgs).toHaveLength(1);
    expect(getText(resultMsgs)).toBe('Hello, how are you?');
  });

  test('blocks input matching blocklist pattern', async () => {
    const processor = createModerationProcessor({ blocklist: ['forbidden'] });
    const messages = [msg('user', 'This is forbidden content')];
    const result = await processor.processInput!({
      messages: messages as any,
      messageList: { messages } as any,
      systemMessages: [],
      state: {},
      abort: (() => {}) as never,
      retryCount: 0,
    } as any);
    const resultMsgs = Array.isArray(result) ? result : [];
    expect(getText(resultMsgs)).toBe(MODERATION_NOTICE);
  });

  test('blocklist matching is case-insensitive', async () => {
    const processor = createModerationProcessor({ blocklist: ['blocked'] });
    const messages = [msg('user', 'BLOCKED content here')];
    const result = await processor.processInput!({
      messages: messages as any,
      messageList: { messages } as any,
      systemMessages: [],
      state: {},
      abort: (() => {}) as never,
      retryCount: 0,
    } as any);
    const resultMsgs = Array.isArray(result) ? result : [];
    expect(getText(resultMsgs)).toBe(MODERATION_NOTICE);
  });

  test('enforces maxLength', async () => {
    const processor = createModerationProcessor({ maxLength: 10 });
    const messages = [
      msg('user', 'This message is way too long for the limit'),
    ];
    const result = await processor.processInput!({
      messages: messages as any,
      messageList: { messages } as any,
      systemMessages: [],
      state: {},
      abort: (() => {}) as never,
      retryCount: 0,
    } as any);
    const resultMsgs = Array.isArray(result) ? result : [];
    expect(getText(resultMsgs)).toBe(MODERATION_NOTICE);
  });

  test('does not modify non-user messages', async () => {
    const processor = createModerationProcessor({ blocklist: ['forbidden'] });
    const messages = [msg('assistant', 'This is forbidden but from assistant')];
    const result = await processor.processInput!({
      messages: messages as any,
      messageList: { messages } as any,
      systemMessages: [],
      state: {},
      abort: (() => {}) as never,
      retryCount: 0,
    } as any);
    const resultMsgs = Array.isArray(result) ? result : [];
    expect(getText(resultMsgs)).toBe('This is forbidden but from assistant');
  });

  test('preserves earlier messages when blocking last', async () => {
    const processor = createModerationProcessor({ blocklist: ['badword'] });
    const messages = [msg('assistant', 'Hello!'), msg('user', 'badword here')];
    const result = await processor.processInput!({
      messages: messages as any,
      messageList: { messages } as any,
      systemMessages: [],
      state: {},
      abort: (() => {}) as never,
      retryCount: 0,
    } as any);
    const resultMsgs = Array.isArray(result) ? result : [];
    expect(resultMsgs).toHaveLength(2);
    expect(extractText((resultMsgs[0] as any).content)).toBe('Hello!');
    expect(getText(resultMsgs)).toBe(MODERATION_NOTICE);
  });
});

describe('onBlock callback', () => {
  function callProcessor(
    config: { blocklist?: string[]; maxLength?: number },
    onBlock: (info: ModerationBlockInfo) => void,
    text: string,
  ) {
    const processor = createModerationProcessor(config, onBlock);
    const messages = [msg('user', text)];
    return processor.processInput!({
      messages: messages as any,
      messageList: { messages } as any,
      systemMessages: [],
      state: {},
      abort: (() => {}) as never,
      retryCount: 0,
    } as any);
  }

  test('calls onBlock with reason=blocklist and matched term', async () => {
    const calls: ModerationBlockInfo[] = [];
    await callProcessor(
      { blocklist: ['forbidden', 'blocked'] },
      (info) => calls.push(info),
      'This is forbidden content',
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].reason).toBe('blocklist');
    expect(calls[0].matchedTerm).toBe('forbidden');
    expect(calls[0].content).toBe('This is forbidden content');
  });

  test('calls onBlock with reason=max_length', async () => {
    const calls: ModerationBlockInfo[] = [];
    await callProcessor(
      { maxLength: 5 },
      (info) => calls.push(info),
      'This is too long',
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].reason).toBe('max_length');
    expect(calls[0].matchedTerm).toBeUndefined();
  });

  test('does not call onBlock when message passes', async () => {
    const calls: ModerationBlockInfo[] = [];
    await callProcessor(
      { blocklist: ['badword'] },
      (info) => calls.push(info),
      'Hello, this is fine',
    );
    expect(calls).toHaveLength(0);
  });

  test('works without onBlock callback (backward compat)', async () => {
    const processor = createModerationProcessor({ blocklist: ['bad'] });
    const messages = [msg('user', 'bad content')];
    const result = await processor.processInput!({
      messages: messages as any,
      messageList: { messages } as any,
      systemMessages: [],
      state: {},
      abort: (() => {}) as never,
      retryCount: 0,
    } as any);
    const resultMsgs = Array.isArray(result) ? result : [];
    expect(getText(resultMsgs)).toBe(MODERATION_NOTICE);
  });

  test('onBlock error does not prevent moderation', async () => {
    const processor = createModerationProcessor({ blocklist: ['bad'] }, () => {
      throw new Error('DB insert failed');
    });
    const messages = [msg('user', 'bad content')];
    const result = await processor.processInput!({
      messages: messages as any,
      messageList: { messages } as any,
      systemMessages: [],
      state: {},
      abort: (() => {}) as never,
      retryCount: 0,
    } as any);
    // Moderation should still work despite callback failure
    const resultMsgs = Array.isArray(result) ? result : [];
    expect(getText(resultMsgs)).toBe(MODERATION_NOTICE);
  });
});
