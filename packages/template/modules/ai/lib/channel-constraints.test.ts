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
  });

  it('returns web constraints', () => {
    const c = getConstraints('web');
    expect(c.maxButtons).toBeNull();
    expect(c.maxButtonLabelLength).toBe(100);
    expect(c.maxBodyLength).toBe(10000);
    expect(c.supportsMarkdown).toBe(true);
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
  });

  it('mentions unlimited buttons for web', () => {
    const text = formatConstraintsForPrompt('web');
    expect(text).toContain('Unlimited');
  });

  it('falls back to web for unknown channel', () => {
    const text = formatConstraintsForPrompt('xyz');
    expect(text).toContain('Web');
  });
});
