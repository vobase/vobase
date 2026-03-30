import { describe, expect, test } from 'bun:test';

import { createChannelBridge } from './chat-bridge';
import { buildInteractiveCard, buildTemplateCard } from './chat-cards';

// ─── Mock deps ───────────────────────────────────────────────────────

const mockDb = {} as never;
const mockScheduler = {
  add: async () => ({ id: 'job-1' }),
} as never;

// ─── Serialization tests ─────────────────────────────────────────────

describe('chat-bridge serialization', () => {
  const bridge = createChannelBridge(
    { id: 'ci-wa-1', type: 'whatsapp', label: 'WhatsApp Main' },
    { db: mockDb, scheduler: mockScheduler },
  );

  test('parseMessage converts MessageReceivedEvent to Message', () => {
    const event = {
      type: 'message_received',
      channel: 'whatsapp',
      from: '+6591234567',
      profileName: 'Test User',
      messageId: 'msg-001',
      content: 'Hello world',
      messageType: 'text',
      timestamp: 1711234567000,
    };

    const message = bridge.parseMessage(event as never);
    expect(message.id).toBe('msg-001');
    expect(message.text).toBe('Hello world');
    expect(message.author.userId).toBe('+6591234567');
    expect(message.author.fullName).toBe('Test User');
    expect(message.author.isBot).toBe(false);
  });

  test('encodeThreadId/decodeThreadId are identity functions', () => {
    expect(bridge.encodeThreadId('session-123')).toBe('session-123');
    expect(bridge.decodeThreadId('session-123')).toBe('session-123');
  });

  test('channelIdFromThreadId returns instance ID', () => {
    expect(bridge.channelIdFromThreadId('any-thread')).toBe('ci-wa-1');
  });

  test('isDM returns true for all threads', () => {
    expect(bridge.isDM?.('any-thread')).toBe(true);
  });

  test('persistMessageHistory is true', () => {
    expect(bridge.persistMessageHistory).toBe(true);
  });

  test('handleWebhook throws', async () => {
    expect(
      bridge.handleWebhook(new Request('http://localhost')),
    ).rejects.toThrow('Not used');
  });

  test('editMessage throws', async () => {
    expect(bridge.editMessage('t', 'm', 'text')).rejects.toThrow(
      'Not supported',
    );
  });

  test('deleteMessage throws', async () => {
    expect(bridge.deleteMessage('t', 'm')).rejects.toThrow('Not supported');
  });

  test('fetchMessages returns empty', async () => {
    const result = await bridge.fetchMessages('t');
    expect(result.messages).toEqual([]);
  });
});

// ─── Card serialization tests ────────────────────────────────────────

describe('card serialization', () => {
  test('buildTemplateCard creates card with template metadata', () => {
    const card = buildTemplateCard('welcome', 'en', ['John']);
    expect(card.type).toBe('card');
    expect(card.title).toContain('welcome');
    // Metadata attached for bridge detection
    expect((card as unknown as Record<string, unknown>).metadata).toEqual({
      template: { name: 'welcome', language: 'en', parameters: ['John'] },
    });
  });

  test('buildInteractiveCard creates card with action buttons', () => {
    const card = buildInteractiveCard('Choose', 'Pick one', [
      { id: 'opt-a', title: 'Option A' },
      { id: 'opt-b', title: 'Option B' },
    ]);
    expect(card.type).toBe('card');
    expect(card.title).toBe('Choose');
    // Should have text + actions children
    expect(card.children.length).toBe(2);
    expect(card.children[1].type).toBe('actions');
  });

  test('buildInteractiveCard enforces max 3 buttons', () => {
    const card = buildInteractiveCard('Choose', 'Pick one', [
      { id: '1', title: 'A' },
      { id: '2', title: 'B' },
      { id: '3', title: 'C' },
      { id: '4', title: 'D' }, // Should be dropped
    ]);
    const actions = card.children.find((c) => c.type === 'actions');
    expect(actions).toBeDefined();
    // Actions should only have 3 buttons
    expect((actions as { children: unknown[] }).children.length).toBe(3);
  });

  test('buildInteractiveCard truncates button titles to 20 chars', () => {
    const card = buildInteractiveCard('Choose', 'Body', [
      {
        id: '1',
        title: 'This is a very long button title that exceeds twenty',
      },
    ]);
    const actions = card.children.find((c) => c.type === 'actions') as {
      children: { label: string }[];
    };
    expect(actions.children[0].label.length).toBeLessThanOrEqual(20);
  });

  test('buildInteractiveCard truncates body to 1024 chars', () => {
    const longBody = 'x'.repeat(2000);
    const card = buildInteractiveCard('Title', longBody, [
      { id: '1', title: 'OK' },
    ]);
    const textChild = card.children.find((c) => c.type === 'text') as {
      content: string;
    };
    expect(textChild.content.length).toBeLessThanOrEqual(1024);
  });

  test('button callback IDs use chat:{json} format', () => {
    const card = buildInteractiveCard('Choose', 'Body', [
      { id: 'confirm', title: 'Confirm' },
    ]);
    const actions = card.children.find((c) => c.type === 'actions') as {
      children: { id: string }[];
    };
    expect(actions.children[0].id).toBe('chat:"confirm"');
  });
});

// ─── M7: String conversion safety ────────────────────────────────────

describe('chat-bridge fallback serialization (M7)', () => {
  function makeCaptureDb(): {
    db: never;
    getContent: () => string | undefined;
  } {
    let capturedContent: string | undefined;
    const db = {
      insert: () => ({
        values: (vals: { content: string }) => {
          capturedContent = vals.content;
          return {
            returning: async () => [
              {
                id: 'out-1',
                ...vals,
                status: 'queued',
                retryCount: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ],
          };
        },
      }),
      update: () => ({ set: () => ({ where: async () => {} }) }),
    } as never;
    return { db, getContent: () => capturedContent };
  }

  test('null message serializes to JSON.stringify fallback', async () => {
    const { db, getContent } = makeCaptureDb();
    const b = createChannelBridge(
      { id: 'ci-web-1', type: 'web', label: 'Web Chat' },
      { db, scheduler: { add: async () => ({ id: 'j' }) } as never },
    );
    await b.postMessage('session-1', null as never);
    // null ?? '' = '', JSON.stringify('') = '""'
    expect(getContent()).toBe('""');
  });

  test('undefined message serializes to JSON.stringify fallback', async () => {
    const { db, getContent } = makeCaptureDb();
    const b = createChannelBridge(
      { id: 'ci-web-1', type: 'web', label: 'Web Chat' },
      { db, scheduler: { add: async () => ({ id: 'j' }) } as never },
    );
    await b.postMessage('session-1', undefined as never);
    expect(getContent()).toBe('""');
  });

  test('plain string message is passed through unchanged', async () => {
    const { db, getContent } = makeCaptureDb();
    const b = createChannelBridge(
      { id: 'ci-web-1', type: 'web', label: 'Web Chat' },
      { db, scheduler: { add: async () => ({ id: 'j' }) } as never },
    );
    await b.postMessage('session-1', 'hello world' as never);
    expect(getContent()).toBe('hello world');
  });
});
