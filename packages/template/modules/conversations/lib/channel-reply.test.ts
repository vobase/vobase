import { describe, expect, it, mock } from 'bun:test';

// Mock logger to capture warnings without noise
mock.module('@vobase/core', () => ({
  logger: {
    debug: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    info: mock(() => {}),
  },
}));

import { extractSendCardResults } from './channel-reply';

// Build a minimal fake CardElement
function fakeCard(id: string) {
  return { type: 'card' as const, title: id, children: [] as never[] };
}

// Build a tool result chunk with correct .payload nesting
function makeToolResult(toolName: string, result: unknown, isError = false) {
  return {
    type: 'tool-result',
    payload: { toolCallId: 'tc1', toolName, result, isError },
  };
}

describe('extractSendCardResults', () => {
  it('extracts cards from well-formed response.steps with .payload nesting', () => {
    const card = fakeCard('card1');
    const response = {
      steps: [
        {
          toolResults: [makeToolResult('send_card', { card })],
        },
      ],
    };
    const cards = extractSendCardResults(response);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toEqual(card);
  });

  it('returns empty array when response.steps is undefined', () => {
    const cards = extractSendCardResults({});
    expect(cards).toHaveLength(0);
  });

  it('returns empty array when steps is empty', () => {
    const cards = extractSendCardResults({ steps: [] });
    expect(cards).toHaveLength(0);
  });

  it('handles steps with no toolResults gracefully', () => {
    const response = {
      steps: [{ text: 'some text' }],
    };
    const cards = extractSendCardResults(response);
    expect(cards).toHaveLength(0);
  });

  it('handles mixed steps — only extracts send_card results', () => {
    const card = fakeCard('card2');
    const response = {
      steps: [
        {
          toolResults: [
            makeToolResult('check_availability', { slots: [] }),
            makeToolResult('send_card', { card }),
          ],
        },
      ],
    };
    const cards = extractSendCardResults(response);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toEqual(card);
  });

  it('skips tool results with isError=true', () => {
    const response = {
      steps: [
        {
          toolResults: [
            makeToolResult('send_card', { card: fakeCard('x') }, true),
          ],
        },
      ],
    };
    const cards = extractSendCardResults(response);
    expect(cards).toHaveLength(0);
  });

  it('skips tool result missing .card in result', () => {
    const response = {
      steps: [
        {
          toolResults: [
            makeToolResult('send_card', { error: 'Too many buttons' }),
          ],
        },
      ],
    };
    const cards = extractSendCardResults(response);
    expect(cards).toHaveLength(0);
  });

  it('extracts multiple cards from multiple steps', () => {
    const card1 = fakeCard('c1');
    const card2 = fakeCard('c2');
    const response = {
      steps: [
        { toolResults: [makeToolResult('send_card', { card: card1 })] },
        { toolResults: [makeToolResult('send_card', { card: card2 })] },
      ],
    };
    const cards = extractSendCardResults(response);
    expect(cards).toHaveLength(2);
  });

  it('falls back to top-level response.toolResults when steps yield no cards', () => {
    const card = fakeCard('fallback');
    const response = {
      steps: [{ toolResults: [] }],
      toolResults: [makeToolResult('send_card', { card })],
    };
    const cards = extractSendCardResults(response);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toEqual(card);
  });

  it('does NOT use top-level toolResults when steps already found cards', () => {
    const card1 = fakeCard('from-steps');
    const card2 = fakeCard('from-toplevel');
    const response = {
      steps: [{ toolResults: [makeToolResult('send_card', { card: card1 })] }],
      toolResults: [makeToolResult('send_card', { card: card2 })],
    };
    const cards = extractSendCardResults(response);
    // Only card1 from steps — top-level fallback is skipped
    expect(cards).toHaveLength(1);
    expect(cards[0]).toEqual(card1);
  });
});
