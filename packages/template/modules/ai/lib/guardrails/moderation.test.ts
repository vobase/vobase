import { describe, expect, test } from 'bun:test';

import {
  createModerationProcessor,
  extractText,
  MODERATION_NOTICE,
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
    const messages = [msg('user', 'This message is way too long for the limit')];
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
