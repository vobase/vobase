import { describe, expect, it } from 'bun:test';

import { groupMessagesIntoTurns } from './group-turns';
import type { NormalizedMessage } from './normalize-message';

function makeMsg(
  overrides: Partial<NormalizedMessage> & {
    id: string;
    role: 'user' | 'assistant';
  },
): NormalizedMessage {
  return {
    parts: [{ type: 'text', text: 'hello' }],
    metadata: {},
    ...overrides,
  };
}

describe('groupMessagesIntoTurns', () => {
  it('returns empty array for empty input', () => {
    expect(groupMessagesIntoTurns([])).toEqual([]);
  });

  it('groups a single message into one turn', () => {
    const messages = [makeMsg({ id: '1', role: 'user' })];
    const turns = groupMessagesIntoTurns(messages);
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('user');
    expect(turns[0].messages).toHaveLength(1);
    expect(turns[0].senderLabel).toBe('Visitor');
  });

  it('groups alternating roles into separate turns', () => {
    const messages = [
      makeMsg({ id: '1', role: 'user' }),
      makeMsg({ id: '2', role: 'assistant' }),
      makeMsg({ id: '3', role: 'user' }),
    ];
    const turns = groupMessagesIntoTurns(messages);
    expect(turns).toHaveLength(3);
    expect(turns[0].role).toBe('user');
    expect(turns[1].role).toBe('assistant');
    expect(turns[2].role).toBe('user');
  });

  it('merges consecutive same-role messages', () => {
    const messages = [
      makeMsg({ id: '1', role: 'assistant' }),
      makeMsg({ id: '2', role: 'assistant' }),
      makeMsg({ id: '3', role: 'assistant' }),
    ];
    const turns = groupMessagesIntoTurns(messages);
    expect(turns).toHaveLength(1);
    expect(turns[0].messages).toHaveLength(3);
    expect(turns[0].id).toBe('1');
    expect(turns[0].senderLabel).toBe('AI Agent');
  });

  it('detects staff reply sender label via metadata', () => {
    const messages = [
      makeMsg({
        id: '1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'some reply' }],
        metadata: { isStaffReply: true, staffName: 'Alice' },
      }),
    ];
    const turns = groupMessagesIntoTurns(messages);
    expect(turns[0].senderLabel).toBe('Staff: Alice');
  });

  it('detects staff reply sender label via text prefix fallback', () => {
    const messages = [
      makeMsg({
        id: '1',
        role: 'assistant',
        parts: [{ type: 'text', text: '[Staff: Bob] Here is the answer' }],
        metadata: {},
      }),
    ];
    const turns = groupMessagesIntoTurns(messages);
    expect(turns[0].senderLabel).toBe('Staff: Bob');
  });

  it('uses provided contactLabel for user turns', () => {
    const messages = [makeMsg({ id: '1', role: 'user' })];
    const turns = groupMessagesIntoTurns(messages, 'John Doe');
    expect(turns[0].senderLabel).toBe('John Doe');
  });

  it('preserves timestamp from first message', () => {
    const messages = [
      makeMsg({ id: '1', role: 'user', createdAt: '2026-01-01T00:00:00Z' }),
      makeMsg({ id: '2', role: 'user', createdAt: '2026-01-01T00:01:00Z' }),
    ];
    const turns = groupMessagesIntoTurns(messages);
    expect(turns[0].timestamp).toBe('2026-01-01T00:00:00Z');
  });

  it('handles complex mixed sequence', () => {
    const messages = [
      makeMsg({ id: '1', role: 'user' }),
      makeMsg({ id: '2', role: 'assistant' }),
      makeMsg({ id: '3', role: 'assistant' }),
      makeMsg({ id: '4', role: 'user' }),
      makeMsg({ id: '5', role: 'user' }),
      makeMsg({ id: '6', role: 'assistant' }),
    ];
    const turns = groupMessagesIntoTurns(messages);
    expect(turns).toHaveLength(4);
    expect(turns[0].messages).toHaveLength(1); // user
    expect(turns[1].messages).toHaveLength(2); // assistant x2
    expect(turns[2].messages).toHaveLength(2); // user x2
    expect(turns[3].messages).toHaveLength(1); // assistant
  });
});
