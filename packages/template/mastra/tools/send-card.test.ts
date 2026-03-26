import { describe, expect, it } from 'bun:test';

import { sendCardTool } from './send-card';

type ToolOutput = { card?: unknown; error?: string };

// Helper to run the tool with optional mock requestContext
async function runTool(
  input: {
    title?: string;
    body: string;
    buttons?: {
      id: string;
      label: string;
      style?: 'primary' | 'danger' | 'default';
    }[];
  },
  channel = 'web',
): Promise<ToolOutput> {
  const mockContext = {
    requestContext: {
      get: (key: string) => (key === 'channel' ? channel : undefined),
    },
  } as Parameters<NonNullable<typeof sendCardTool.execute>>[1];

  const result = await sendCardTool.execute?.(input, mockContext);
  return result as ToolOutput;
}

describe('sendCardTool validation', () => {
  it('rejects when button count exceeds whatsapp maxButtons', async () => {
    const result = await runTool(
      {
        body: 'Choose an option',
        buttons: [
          { id: 'a', label: 'Option A' },
          { id: 'b', label: 'Option B' },
          { id: 'c', label: 'Option C' },
          { id: 'd', label: 'Option D' },
        ],
      },
      'whatsapp',
    );
    expect(result.error).toContain('WhatsApp');
    expect(result.error).toContain('3');
    expect(result.card).toBeUndefined();
  });

  it('rejects when button label exceeds maxButtonLabelLength for whatsapp', async () => {
    const result = await runTool(
      {
        body: 'Pick one',
        buttons: [
          { id: 'x', label: 'This label is way too long for WhatsApp' },
        ],
      },
      'whatsapp',
    );
    expect(result.error).toContain('WhatsApp');
    expect(result.error).toContain('20');
    expect(result.card).toBeUndefined();
  });

  it('rejects when body exceeds maxBodyLength', async () => {
    const result = await runTool({ body: 'x'.repeat(1025) }, 'whatsapp');
    expect(result.error).toContain('1024');
    expect(result.card).toBeUndefined();
  });

  it('allows 3 buttons with short labels on whatsapp', async () => {
    const result = await runTool(
      {
        body: 'Choose:',
        buttons: [
          { id: 'yes', label: 'Yes' },
          { id: 'no', label: 'No' },
          { id: 'maybe', label: 'Maybe' },
        ],
      },
      'whatsapp',
    );
    expect(result.error).toBeUndefined();
    expect(result.card).toBeDefined();
  });
});

describe('sendCardTool CardElement construction', () => {
  it('builds a CardElement with title, text, and buttons', async () => {
    const result = await runTool({
      title: 'Hello',
      body: 'Pick an option',
      buttons: [
        { id: 'opt1', label: 'Option 1' },
        { id: 'opt2', label: 'Option 2' },
      ],
    });
    expect(result.error).toBeUndefined();
    expect(result.card).toBeDefined();
    const card = result.card as Record<string, unknown>;
    expect(card.type).toBe('card');
    expect(card.title).toBe('Hello');
  });

  it('button IDs use chat:JSON.stringify(id) format', async () => {
    const result = await runTool({
      body: 'Select:',
      buttons: [{ id: 'confirm', label: 'Confirm' }],
    });
    expect(result.card).toBeDefined();
    const card = result.card as Record<string, unknown>;
    const children = card.children as Array<Record<string, unknown>>;
    const actions = children.find((c) => c.type === 'actions');
    expect(actions).toBeDefined();
    const actionChildren = actions?.children as Array<Record<string, unknown>>;
    const btn = actionChildren[0];
    expect(btn.id).toBe('chat:"confirm"');
  });

  it('builds a card without buttons', async () => {
    const result = await runTool({ body: 'Hello world' });
    expect(result.error).toBeUndefined();
    expect(result.card).toBeDefined();
    const card = result.card as Record<string, unknown>;
    const children = card.children as Array<Record<string, unknown>>;
    expect(children.every((c) => c.type !== 'actions')).toBe(true);
  });
});

describe('sendCardTool channel fallback', () => {
  it('defaults to web constraints when no requestContext channel', async () => {
    // 5000 chars < web maxBodyLength (10000), should succeed
    const result = (await sendCardTool.execute?.(
      { body: 'x'.repeat(5000) },
      undefined as unknown as Parameters<
        NonNullable<typeof sendCardTool.execute>
      >[1],
    )) as ToolOutput;
    expect(result.error).toBeUndefined();
    expect(result.card).toBeDefined();
  });
});
