import { describe, expect, test } from 'bun:test';

import {
  buildWakeMessage,
  estimateTokens,
  type WakeMessageEntry,
} from './wake-message';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// estimateTokens
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('estimateTokens', () => {
  test('empty string returns 0', () => {
    expect(estimateTokens('')).toBe(0);
  });

  test('short string rounds up', () => {
    expect(estimateTokens('hi')).toBe(1); // 2 chars -> ceil(2/4) = 1
  });

  test('exact multiple', () => {
    expect(estimateTokens('abcd')).toBe(1); // 4 chars -> ceil(4/4) = 1
  });

  test('longer text', () => {
    const text = 'a'.repeat(100);
    expect(estimateTokens(text)).toBe(25);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// buildWakeMessage — non-inbound triggers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('buildWakeMessage — scheduled_followup', () => {
  test('uses payload reason', () => {
    const result = buildWakeMessage({
      trigger: 'scheduled_followup',
      messages: [],
      payload: { reason: 'Weekly check-in' },
    });
    expect(result).toBe(
      'Scheduled follow-up: Weekly check-in. Read conversation/messages.md for context.',
    );
  });

  test('uses default reason when payload missing', () => {
    const result = buildWakeMessage({
      trigger: 'scheduled_followup',
      messages: [],
    });
    expect(result).toContain('Check in with contact');
  });
});

describe('buildWakeMessage — supervisor', () => {
  test('uses payload instruction', () => {
    const result = buildWakeMessage({
      trigger: 'supervisor',
      messages: [],
      payload: { instruction: 'Escalate to human' },
    });
    expect(result).toBe(
      'Supervisor instruction: Escalate to human. Read conversation/messages.md for context.',
    );
  });

  test('uses default instruction when payload missing', () => {
    const result = buildWakeMessage({
      trigger: 'supervisor',
      messages: [],
    });
    expect(result).toContain('Review conversation');
  });
});

describe('buildWakeMessage — manual', () => {
  test('uses payload reason', () => {
    const result = buildWakeMessage({
      trigger: 'manual',
      messages: [],
      payload: { reason: 'Debug issue' },
    });
    expect(result).toBe(
      'Manual wake: Debug issue. Read conversation/messages.md for context.',
    );
  });

  test('uses default reason when payload missing', () => {
    const result = buildWakeMessage({
      trigger: 'manual',
      messages: [],
    });
    expect(result).toContain('Agent wake requested');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// buildWakeMessage — inbound_message
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function msg(from: string, content: string, time = '10:00'): WakeMessageEntry {
  return { time, from, content };
}

describe('buildWakeMessage — inbound_message', () => {
  test('no messages falls back to read-file hint', () => {
    const result = buildWakeMessage({
      trigger: 'inbound_message',
      messages: [],
    });
    expect(result).toContain('Read conversation/messages.md');
  });

  test('single short message is always included', () => {
    const result = buildWakeMessage({
      trigger: 'inbound_message',
      messages: [msg('Alice', 'Hello')],
    });
    expect(result).toContain('[10:00] Alice: Hello');
    expect(result).toContain('New messages:');
    expect(result).toContain('conversation/messages.md');
    expect(result).not.toContain('earlier message(s) not shown');
  });

  test('quick back-and-forth within budget', () => {
    const messages: WakeMessageEntry[] = [
      msg('Alice', 'Hey', '10:00'),
      msg('Bot', 'Hi there!', '10:01'),
      msg('Alice', 'How are you?', '10:02'),
    ];
    const result = buildWakeMessage({
      trigger: 'inbound_message',
      messages,
      budget: 500,
    });
    // All 3 should fit in a generous budget
    expect(result).toContain('[10:00] Alice: Hey');
    expect(result).toContain('[10:01] Bot: Hi there!');
    expect(result).toContain('[10:02] Alice: How are you?');
    expect(result).not.toContain('earlier message(s) not shown');
  });

  test('one very long message always included even if over budget', () => {
    const longContent = 'x'.repeat(3000); // ~750 tokens
    const result = buildWakeMessage({
      trigger: 'inbound_message',
      messages: [msg('Alice', longContent)],
      budget: 100,
    });
    expect(result).toContain(longContent);
    expect(result).not.toContain('earlier message(s) not shown');
  });

  test('budget overflow — older messages omitted', () => {
    const messages: WakeMessageEntry[] = [
      msg('Alice', 'a'.repeat(400), '10:00'), // ~100+ tokens
      msg('Bob', 'b'.repeat(400), '10:01'),
      msg('Alice', 'c'.repeat(400), '10:02'),
      msg('Bob', 'Latest message', '10:03'),
    ];
    const result = buildWakeMessage({
      trigger: 'inbound_message',
      messages,
      budget: 150, // tight budget
    });
    // Most recent message always included
    expect(result).toContain('[10:03] Bob: Latest message');
    // Should show omission notice
    expect(result).toContain('earlier message(s) not shown');
    expect(result).toContain('conversation/messages.md for full history');
  });

  test('rapid burst — many short messages', () => {
    const messages: WakeMessageEntry[] = Array.from({ length: 20 }, (_, i) =>
      msg('User', `msg ${i}`, `10:${String(i).padStart(2, '0')}`),
    );
    const result = buildWakeMessage({
      trigger: 'inbound_message',
      messages,
      budget: 50, // very tight budget to force overflow
    });
    // Most recent should always be present
    expect(result).toContain('[10:19] User: msg 19');
    // With tight budget, not all 20 can fit
    expect(result).toContain('earlier message(s) not shown');
    expect(result).toContain('conversation/messages.md');
  });

  test('messages appear in chronological order', () => {
    const messages: WakeMessageEntry[] = [
      msg('A', 'first', '10:00'),
      msg('B', 'second', '10:01'),
      msg('C', 'third', '10:02'),
    ];
    const result = buildWakeMessage({
      trigger: 'inbound_message',
      messages,
      budget: 500,
    });
    const firstIdx = result.indexOf('[10:00]');
    const secondIdx = result.indexOf('[10:01]');
    const thirdIdx = result.indexOf('[10:02]');
    expect(firstIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(thirdIdx);
  });

  test('omission count is correct', () => {
    const messages: WakeMessageEntry[] = Array.from({ length: 10 }, (_, i) =>
      msg('User', 'x'.repeat(200), `10:${String(i).padStart(2, '0')}`),
    );
    const result = buildWakeMessage({
      trigger: 'inbound_message',
      messages,
      budget: 200,
    });
    // Extract the omission count
    const match = result.match(/\((\d+) earlier message\(s\) not shown/);
    expect(match).not.toBeNull();
    const omitted = Number(match?.[1]);
    // Total is 10, so omitted + shown = 10
    const shownCount = 10 - omitted;
    // At least 1 shown (the most recent)
    expect(shownCount).toBeGreaterThanOrEqual(1);
    expect(omitted).toBeGreaterThan(0);
  });

  test('custom budget of 0 still includes most recent message', () => {
    const result = buildWakeMessage({
      trigger: 'inbound_message',
      messages: [msg('Alice', 'Hello'), msg('Bob', 'World')],
      budget: 0,
    });
    // Most recent always included
    expect(result).toContain('[10:00] Bob: World');
  });
});
