import { describe, expect, it } from 'bun:test';

import { sendCardTool } from './send-card';

type ToolOutput = { success: boolean; message: string; error?: string };

// Mock deps that return a conversation matching the contact
function mockDeps(contactId: string, conversationId: string) {
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () =>
            Promise.resolve([
              {
                id: conversationId,
                contactId,
                channelInstanceId: 'ch-1',
              },
            ]),
        }),
      }),
    },
    realtime: { notify: () => Promise.resolve() },
    scheduler: { add: () => Promise.resolve() },
  };
}

// Mock deps that return no conversation
function mockDepsNoConversation() {
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
    },
    realtime: { notify: () => Promise.resolve() },
    scheduler: { add: () => Promise.resolve() },
  };
}

function makeContext(overrides: Record<string, unknown> = {}, channel = 'web') {
  const map: Record<string, unknown> = {
    channel,
    contactId: 'contact-1',
    agentId: 'agent-1',
    deps: mockDeps('contact-1', 'conv-1'),
    ...overrides,
  };
  return {
    requestContext: {
      get: (key: string) => map[key],
    },
  } as Parameters<NonNullable<typeof sendCardTool.execute>>[1];
}

describe('sendCardTool validation', () => {
  it('returns error when no deps context', async () => {
    const ctx = {
      requestContext: { get: () => undefined },
    } as unknown as Parameters<NonNullable<typeof sendCardTool.execute>>[1];
    const result = (await sendCardTool.execute?.(
      { conversationId: 'conv-1', body: 'hi' },
      ctx,
    )) as ToolOutput;
    expect(result.success).toBe(false);
    expect(result.message).toContain('No deps');
  });

  it('returns error when no contactId', async () => {
    const ctx = makeContext({ contactId: undefined });
    const result = (await sendCardTool.execute?.(
      { conversationId: 'conv-1', body: 'hi' },
      ctx,
    )) as ToolOutput;
    expect(result.success).toBe(false);
    expect(result.message).toContain('No contact');
  });

  it('returns error when conversation not found', async () => {
    const ctx = makeContext({ deps: mockDepsNoConversation() });
    const result = (await sendCardTool.execute?.(
      { conversationId: 'conv-missing', body: 'hi' },
      ctx,
    )) as ToolOutput;
    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });

  it('rejects when button count exceeds whatsapp maxButtons', async () => {
    const ctx = makeContext({}, 'whatsapp');
    const result = (await sendCardTool.execute?.(
      {
        conversationId: 'conv-1',
        body: 'Choose an option',
        buttons: [
          { id: 'a', label: 'Option A' },
          { id: 'b', label: 'Option B' },
          { id: 'c', label: 'Option C' },
          { id: 'd', label: 'Option D' },
        ],
      },
      ctx,
    )) as ToolOutput;
    expect(result.error).toContain('WhatsApp');
    expect(result.error).toContain('3');
  });

  it('rejects when button label exceeds maxButtonLabelLength for whatsapp', async () => {
    const ctx = makeContext({}, 'whatsapp');
    const result = (await sendCardTool.execute?.(
      {
        conversationId: 'conv-1',
        body: 'Pick one',
        buttons: [
          { id: 'x', label: 'This label is way too long for WhatsApp' },
        ],
      },
      ctx,
    )) as ToolOutput;
    expect(result.error).toContain('WhatsApp');
    expect(result.error).toContain('20');
  });

  it('rejects when body exceeds maxBodyLength', async () => {
    const ctx = makeContext({}, 'whatsapp');
    const result = (await sendCardTool.execute?.(
      { conversationId: 'conv-1', body: 'x'.repeat(1025) },
      ctx,
    )) as ToolOutput;
    expect(result.error).toContain('1024');
  });
});

describe('sendCardTool success', () => {
  it('succeeds with valid input and stores message', async () => {
    let insertedMessage: Record<string, unknown> | undefined;
    const deps = {
      db: {
        select: () => ({
          from: () => ({
            where: () =>
              Promise.resolve([
                {
                  id: 'conv-1',
                  contactId: 'contact-1',
                  channelInstanceId: 'ch-1',
                },
              ]),
          }),
        }),
        insert: () => ({
          values: (msg: Record<string, unknown>) => {
            insertedMessage = msg;
            return {
              returning: () => Promise.resolve([{ id: 'msg-1', ...msg }]),
            };
          },
        }),
      },
      realtime: { notify: () => Promise.resolve() },
      scheduler: { add: () => Promise.resolve() },
    };
    const ctx = makeContext({ deps });
    const result = (await sendCardTool.execute?.(
      {
        conversationId: 'conv-1',
        body: 'Choose:',
        buttons: [
          { id: 'yes', label: 'Yes' },
          { id: 'no', label: 'No' },
        ],
      },
      ctx,
    )) as ToolOutput;
    expect(result.success).toBe(true);
    expect(result.message).toBe('Card sent.');
  });
});
