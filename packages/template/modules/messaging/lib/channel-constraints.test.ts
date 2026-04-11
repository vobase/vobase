import { describe, expect, it } from 'bun:test';

import {
  CHANNEL_CONSTRAINTS,
  formatConstraintsForPrompt,
  getConstraints,
} from './channel-constraints';

describe('getConstraints', () => {
  it('returns whatsapp constraints', () => {
    const c = getConstraints('whatsapp');
    expect(c.maxButtons).toBe(3);
    expect(c.maxButtonLabelLength).toBe(20);
    expect(c.maxBodyLength).toBe(1024);
    expect(c.supportsMarkdown).toBe(false);
    expect(c.name).toBe('WhatsApp');
    expect(c.supportsLists).toBe(true);
    expect(c.maxListItems).toBe(10);
    expect(c.supportsMedia).toEqual(['image', 'document', 'audio', 'video']);
    expect(c.supportsTemplates).toBe(true);
    expect(c.supportsReactions).toBe(true);
    expect(c.supportsReadReceipts).toBe(true);
    expect(c.messagingWindowHours).toBe(24);
    expect(c.supportsTypingIndicators).toBe(false);
  });

  it('returns web constraints', () => {
    const c = getConstraints('web');
    expect(c.maxButtons).toBeNull();
    expect(c.maxButtonLabelLength).toBe(100);
    expect(c.maxBodyLength).toBe(10000);
    expect(c.supportsMarkdown).toBe(true);
    expect(c.supportsLists).toBe(false);
    expect(c.maxListItems).toBeNull();
    expect(c.supportsMedia).toEqual(['image', 'document']);
    expect(c.supportsTemplates).toBe(false);
    expect(c.supportsReactions).toBe(true);
    expect(c.supportsReadReceipts).toBe(false);
    expect(c.messagingWindowHours).toBeNull();
    expect(c.supportsTypingIndicators).toBe(true);
  });

  it('falls back to web defaults for unknown channel', () => {
    const c = getConstraints('unknown-channel');
    expect(c).toEqual(CHANNEL_CONSTRAINTS.web);
  });

  it('returns telegram constraints', () => {
    const c = getConstraints('telegram');
    expect(c.maxButtons).toBe(8);
    expect(c.maxButtonLabelLength).toBe(64);
    expect(c.maxBodyLength).toBe(4096);
    expect(c.supportsMarkdown).toBe(true);
    expect(c.name).toBe('Telegram');
    expect(c.supportsLists).toBe(false);
    expect(c.maxListItems).toBeNull();
    expect(c.supportsMedia).toEqual(['image', 'document', 'audio', 'video']);
    expect(c.supportsTemplates).toBe(false);
    expect(c.supportsReactions).toBe(true);
    expect(c.supportsReadReceipts).toBe(true);
    expect(c.messagingWindowHours).toBeNull();
    expect(c.supportsTypingIndicators).toBe(true);
  });
});

describe('formatConstraintsForPrompt', () => {
  it('returns human-readable string mentioning whatsapp limits', () => {
    const text = formatConstraintsForPrompt('whatsapp');
    expect(text).toContain('WhatsApp');
    expect(text).toContain('3');
    expect(text).toContain('20');
    expect(text).toContain('1024');
    expect(text).toContain('plain text');
    expect(text).toContain('max 10 items');
    expect(text).toContain('image');
    expect(text).toContain('24h');
  });

  it('mentions unlimited buttons for web', () => {
    const text = formatConstraintsForPrompt('web');
    expect(text).toContain('Unlimited');
    expect(text).toContain('not supported — use plain text fallback');
    expect(text).toContain('Messaging window: none');
  });

  it('falls back to web for unknown channel', () => {
    const text = formatConstraintsForPrompt('xyz');
    expect(text).toContain('Web');
  });

  it('mentions typing indicators for telegram', () => {
    const text = formatConstraintsForPrompt('telegram');
    expect(text).toContain('Typing indicators: supported');
    expect(text).toContain('Read receipts: supported');
  });
});
