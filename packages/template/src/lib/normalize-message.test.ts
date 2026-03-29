import { describe, expect, it } from 'bun:test';

import {
  convertMemoryPart,
  detectStaffReply,
  extractText,
  getMessageParts,
  isInternalNote,
  type MemoryMessage,
  type NormalizedMessage,
  normalizeMemoryMessage,
  normalizeUIMessage,
} from './normalize-message';

// ─── extractText ────────────────────────────────────────────────────────

describe('extractText', () => {
  it('handles string content', () => {
    expect(extractText('hello world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(extractText('')).toBe('');
  });

  it('handles array content with text parts', () => {
    const content = [
      { type: 'text', text: 'Hello ' },
      { type: 'tool-call', toolName: 'search' },
      { type: 'text', text: 'world' },
    ];
    expect(extractText(content)).toBe('Hello world');
  });

  it('handles format v2 content', () => {
    const content = {
      format: 2,
      parts: [
        { type: 'text', text: 'Hello ' },
        { type: 'tool-call', toolName: 'search' },
        { type: 'text', text: 'there' },
      ],
    };
    expect(extractText(content)).toBe('Hello there');
  });

  it('handles array with no text parts', () => {
    const content = [{ type: 'tool-call', toolName: 'search' }];
    expect(extractText(content)).toBe('');
  });

  it('handles format v2 with no text parts', () => {
    const content = {
      format: 2,
      parts: [{ type: 'tool-call', toolName: 'search' }],
    };
    expect(extractText(content)).toBe('');
  });
});

// ─── convertMemoryPart ──────────────────────────────────────────────────

describe('convertMemoryPart', () => {
  it('converts text part', () => {
    const result = convertMemoryPart({ type: 'text', text: 'hello' });
    expect(result).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('converts tool-call part with result', () => {
    const result = convertMemoryPart({
      type: 'tool-call',
      toolName: 'search',
      result: { items: [] },
      args: { query: 'test' },
    });
    expect(result).toEqual([
      {
        type: 'tool-search',
        state: 'output-available',
        output: { items: [] },
      },
    ]);
  });

  it('converts tool-call part without result', () => {
    const result = convertMemoryPart({
      type: 'tool-call',
      toolName: 'search',
      args: { query: 'test' },
    });
    expect(result).toEqual([
      {
        type: 'tool-search',
        state: 'input-available',
        input: { query: 'test' },
      },
    ]);
  });

  it('passes through unknown parts', () => {
    const part = { type: 'image', url: 'http://example.com/img.png' };
    const result = convertMemoryPart(part);
    expect(result).toEqual([part]);
  });
});

// ─── getMessageParts ────────────────────────────────────────────────────

describe('getMessageParts', () => {
  it('handles string content', () => {
    expect(getMessageParts('hello')).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('handles empty string', () => {
    expect(getMessageParts('')).toEqual([]);
  });

  it('handles array content', () => {
    const content = [
      { type: 'text', text: 'hello' },
      { type: 'tool-call', toolName: 'search', result: { ok: true } },
    ];
    const result = getMessageParts(content);
    expect(result).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'tool-search', state: 'output-available', output: { ok: true } },
    ]);
  });

  it('handles format v2 content', () => {
    const content = {
      format: 2,
      parts: [
        { type: 'text', text: 'response' },
        { type: 'tool-call', toolName: 'get_info', args: { id: '1' } },
      ],
    };
    const result = getMessageParts(content);
    expect(result).toEqual([
      { type: 'text', text: 'response' },
      { type: 'tool-get_info', state: 'input-available', input: { id: '1' } },
    ]);
  });
});

// ─── detectStaffReply ───────────────────────────────────────────────────

describe('detectStaffReply', () => {
  it('detects via metadata (priority)', () => {
    const msg: NormalizedMessage = {
      id: '1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'some reply' }],
      metadata: { isStaffReply: true, staffName: 'Alice' },
    };
    const result = detectStaffReply(msg);
    expect(result).toEqual({ isStaffReply: true, staffName: 'Alice' });
  });

  it('detects via [Staff: Name] text prefix fallback', () => {
    const msg: NormalizedMessage = {
      id: '1',
      role: 'assistant',
      parts: [{ type: 'text', text: '[Staff: Bob] Here is my reply' }],
      metadata: {},
    };
    const result = detectStaffReply(msg);
    expect(result).toEqual({ isStaffReply: true, staffName: 'Bob' });
  });

  it('returns false for non-staff messages', () => {
    const msg: NormalizedMessage = {
      id: '1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'AI response' }],
      metadata: {},
    };
    const result = detectStaffReply(msg);
    expect(result).toEqual({ isStaffReply: false, staffName: null });
  });

  it('metadata takes priority over text prefix', () => {
    const msg: NormalizedMessage = {
      id: '1',
      role: 'assistant',
      parts: [{ type: 'text', text: '[Staff: Old] reply' }],
      metadata: { isStaffReply: true, staffName: 'New' },
    };
    const result = detectStaffReply(msg);
    expect(result).toEqual({ isStaffReply: true, staffName: 'New' });
  });
});

// ─── isInternalNote ─────────────────────────────────────────────────────

describe('isInternalNote', () => {
  it('detects via metadata (priority)', () => {
    const msg: NormalizedMessage = {
      id: '1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'private note' }],
      metadata: { visibility: 'internal' },
    };
    expect(isInternalNote(msg)).toBe(true);
  });

  it('detects via [Internal] text prefix fallback', () => {
    const msg: NormalizedMessage = {
      id: '1',
      role: 'assistant',
      parts: [{ type: 'text', text: '[Internal] This is a private note' }],
      metadata: {},
    };
    expect(isInternalNote(msg)).toBe(true);
  });

  it('returns false for public messages', () => {
    const msg: NormalizedMessage = {
      id: '1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Hello visitor' }],
      metadata: {},
    };
    expect(isInternalNote(msg)).toBe(false);
  });

  it('case insensitive [internal] prefix', () => {
    const msg: NormalizedMessage = {
      id: '1',
      role: 'assistant',
      parts: [{ type: 'text', text: '[internal] note' }],
      metadata: {},
    };
    expect(isInternalNote(msg)).toBe(true);
  });
});

// ─── normalizeUIMessage ─────────────────────────────────────────────────

describe('normalizeUIMessage', () => {
  it('normalizes a text-only user message', () => {
    const uiMsg = {
      id: 'msg-1',
      role: 'user' as const,
      parts: [{ type: 'text' as const, text: 'Hello' }],
      content: '',
    };
    const result = normalizeUIMessage(uiMsg as any);
    expect(result.id).toBe('msg-1');
    expect(result.role).toBe('user');
    expect(result.parts).toEqual([{ type: 'text', text: 'Hello' }]);
    expect(result.metadata).toEqual({});
  });

  it('normalizes an assistant message with tool parts (AI SDK v6)', () => {
    const uiMsg = {
      id: 'msg-2',
      role: 'assistant' as const,
      parts: [
        {
          type: 'tool-search' as const,
          toolCallId: 'tc-1',
          state: 'result',
          input: { q: 'test' },
          output: { found: true },
        },
        { type: 'text' as const, text: 'Found it!' },
      ],
      content: '',
    };
    const result = normalizeUIMessage(uiMsg as any);
    expect(result.role).toBe('assistant');
    expect(result.parts).toHaveLength(2);
    expect(result.parts[0].type).toBe('tool-search');
    expect(result.parts[0].state).toBe('output-available');
    expect(result.parts[0].output).toEqual({ found: true });
    expect(result.parts[1]).toEqual({ type: 'text', text: 'Found it!' });
  });
});

// ─── normalizeMemoryMessage ─────────────────────────────────────────────

describe('normalizeMemoryMessage', () => {
  it('normalizes string content', () => {
    const msg: MemoryMessage = {
      id: 'mem-1',
      role: 'user',
      content: 'Hello there',
      createdAt: '2026-01-01T00:00:00Z',
    };
    const result = normalizeMemoryMessage(msg);
    expect(result.role).toBe('user');
    expect(result.parts).toEqual([{ type: 'text', text: 'Hello there' }]);
    expect(result.metadata).toEqual({});
  });

  it('normalizes format v2 content with metadata', () => {
    const msg: MemoryMessage = {
      id: 'mem-2',
      role: 'assistant',
      content: {
        format: 2,
        parts: [{ type: 'text', text: 'Internal note' }],
        metadata: {
          visibility: 'internal',
          isStaffReply: true,
          staffName: 'Eve',
        },
      },
    };
    const result = normalizeMemoryMessage(msg);
    expect(result.metadata.visibility).toBe('internal');
    expect(result.metadata.isStaffReply).toBe(true);
    expect(result.metadata.staffName).toBe('Eve');
  });

  it('extracts deliveryStatus from message', () => {
    const msg: MemoryMessage = {
      id: 'mem-3',
      role: 'assistant',
      content: 'Reply text',
      deliveryStatus: 'delivered',
    };
    const result = normalizeMemoryMessage(msg);
    expect(result.metadata.deliveryStatus).toBe('delivered');
  });

  it('normalizes array content', () => {
    const msg: MemoryMessage = {
      id: 'mem-4',
      role: 'assistant',
      content: [
        { type: 'text', text: 'response' },
        { type: 'tool-call', toolName: 'search', result: { ok: true } },
      ],
    };
    const result = normalizeMemoryMessage(msg);
    expect(result.parts).toHaveLength(2);
    expect(result.parts[0]).toEqual({ type: 'text', text: 'response' });
    expect(result.parts[1].type).toBe('tool-search');
  });
});
