import { describe, expect, it } from 'bun:test';

import type { MessageReceivedEvent } from '../../../../contracts/channels';
import {
  normalizeBrazilPhone,
  normalizeWhatsAppPhone,
  parseWhatsAppContactUpdates,
  parseWhatsAppEchoes,
  parseWhatsAppMessages,
  shouldUpdateStatus,
  WA_STATUS_ORDER,
  type WhatsAppWebhookPayload,
} from './shared';

// ─── Helpers ─────────────────────────────────────────────────────────

function makePayload(
  messages: object[],
  phoneNumberId = 'pn_123',
): WhatsAppWebhookPayload {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'entry_1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '+1234567890',
                phone_number_id: phoneNumberId,
              },
              messages: messages as WhatsAppWebhookPayload['entry'][0]['changes'][0]['value']['messages'],
            },
          },
        ],
      },
    ],
  };
}

// ─── normalizeBrazilPhone ────────────────────────────────────────────

describe('normalizeBrazilPhone', () => {
  it('leaves canonical 13-digit Brazil number unchanged', () => {
    expect(normalizeBrazilPhone('5511912345678')).toBe('5511912345678');
  });

  it('inserts 9 into 12-digit Brazil number (area 11)', () => {
    expect(normalizeBrazilPhone('551112345678')).toBe('5511912345678');
  });

  it('inserts 9 into 12-digit Brazil number (area 21)', () => {
    expect(normalizeBrazilPhone('552187654321')).toBe('5521987654321');
  });

  it('inserts 9 into 12-digit Brazil number (area 99)', () => {
    expect(normalizeBrazilPhone('559912345678')).toBe('5599912345678');
  });

  it('leaves non-Brazil number unchanged (US)', () => {
    expect(normalizeBrazilPhone('14155551234')).toBe('14155551234');
  });

  it('leaves non-Brazil number unchanged (SG)', () => {
    expect(normalizeBrazilPhone('6591234567')).toBe('6591234567');
  });

  it('leaves 11-digit Brazil-prefix number unchanged (too short to match either pattern)', () => {
    // 55 + 2-digit area + 7-digit local = 11 digits → no pattern match
    expect(normalizeBrazilPhone('551112345')).toBe('551112345');
  });

  it('leaves empty string unchanged', () => {
    expect(normalizeBrazilPhone('')).toBe('');
  });
});

// ─── normalizeWhatsAppPhone ──────────────────────────────────────────

describe('normalizeWhatsAppPhone', () => {
  it('delegates Brazil normalization', () => {
    expect(normalizeWhatsAppPhone('551112345678')).toBe('5511912345678');
  });

  it('leaves canonical Brazil unchanged', () => {
    expect(normalizeWhatsAppPhone('5511912345678')).toBe('5511912345678');
  });

  it('leaves non-Brazil unchanged', () => {
    expect(normalizeWhatsAppPhone('14155551234')).toBe('14155551234');
  });
});

// ─── WA_STATUS_ORDER ─────────────────────────────────────────────────

describe('WA_STATUS_ORDER', () => {
  it('has correct ranks', () => {
    expect(WA_STATUS_ORDER.sent).toBe(1);
    expect(WA_STATUS_ORDER.delivered).toBe(2);
    expect(WA_STATUS_ORDER.read).toBe(3);
    expect(WA_STATUS_ORDER.failed).toBe(0);
  });
});

// ─── shouldUpdateStatus ──────────────────────────────────────────────

describe('shouldUpdateStatus', () => {
  // Rule 1: failed incoming is always accepted
  it('accepts failed when current is null', () => {
    expect(shouldUpdateStatus(null, 'failed')).toBe(true);
  });

  it('accepts failed when current is sent', () => {
    expect(shouldUpdateStatus('sent', 'failed')).toBe(true);
  });

  it('accepts failed when current is delivered', () => {
    expect(shouldUpdateStatus('delivered', 'failed')).toBe(true);
  });

  it('accepts failed when current is read', () => {
    expect(shouldUpdateStatus('read', 'failed')).toBe(true);
  });

  it('accepts failed when current is already failed', () => {
    expect(shouldUpdateStatus('failed', 'failed')).toBe(true);
  });

  // Rule 2: recovery from failed is always accepted
  it('accepts sent when current is failed (recovery)', () => {
    expect(shouldUpdateStatus('failed', 'sent')).toBe(true);
  });

  it('accepts delivered when current is failed (recovery)', () => {
    expect(shouldUpdateStatus('failed', 'delivered')).toBe(true);
  });

  it('accepts read when current is failed (recovery)', () => {
    expect(shouldUpdateStatus('failed', 'read')).toBe(true);
  });

  // Rule 3: only accept if incoming rank > current rank
  it('accepts sent when current is null', () => {
    expect(shouldUpdateStatus(null, 'sent')).toBe(true);
  });

  it('accepts delivered when current is sent', () => {
    expect(shouldUpdateStatus('sent', 'delivered')).toBe(true);
  });

  it('accepts read when current is delivered', () => {
    expect(shouldUpdateStatus('delivered', 'read')).toBe(true);
  });

  it('accepts read when current is sent', () => {
    expect(shouldUpdateStatus('sent', 'read')).toBe(true);
  });

  it('rejects sent when current is delivered', () => {
    expect(shouldUpdateStatus('delivered', 'sent')).toBe(false);
  });

  it('rejects sent when current is read', () => {
    expect(shouldUpdateStatus('read', 'sent')).toBe(false);
  });

  it('rejects delivered when current is read', () => {
    expect(shouldUpdateStatus('read', 'delivered')).toBe(false);
  });

  it('rejects sent when current is sent (same rank)', () => {
    expect(shouldUpdateStatus('sent', 'sent')).toBe(false);
  });

  it('rejects delivered when current is delivered (same rank)', () => {
    expect(shouldUpdateStatus('delivered', 'delivered')).toBe(false);
  });

  it('rejects read when current is read (same rank)', () => {
    expect(shouldUpdateStatus('read', 'read')).toBe(false);
  });

  it('accepts unknown incoming when current is null (rank -1 vs -1 → false)', () => {
    // Both unknown → rank -1 vs -1 → not strictly greater
    expect(shouldUpdateStatus(null, 'unknown_status')).toBe(false);
  });

  it('accepts known incoming when current is unknown', () => {
    // sent(1) > unknown(-1)
    expect(shouldUpdateStatus('unknown_status', 'sent')).toBe(true);
  });
});

// ─── parseWhatsAppMessages — referral capture ────────────────────────

describe('parseWhatsAppMessages — referral', () => {
  it('captures referral field in metadata', async () => {
    const referral = {
      source_url: 'https://fb.com/ad/123',
      source_type: 'ad' as const,
      source_id: 'ad_123',
      headline: 'Buy now',
      ctwa_clid: 'clid_abc',
    };
    const payload = makePayload([
      {
        from: '14155551234',
        id: 'msg_1',
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'Hi from ad' },
        referral,
      },
    ]);

    const events = await parseWhatsAppMessages(payload, null);
    expect(events).toHaveLength(1);
    const event = events[0] as MessageReceivedEvent;
    expect(event.metadata?.referral).toEqual(referral);
  });

  it('omits referral key when not present', async () => {
    const payload = makePayload([
      {
        from: '14155551234',
        id: 'msg_2',
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'Hi' },
      },
    ]);

    const events = await parseWhatsAppMessages(payload, null);
    const event = events[0] as MessageReceivedEvent;
    expect(event.metadata?.referral).toBeUndefined();
  });
});

// ─── parseWhatsAppMessages — voice vs audio ──────────────────────────

describe('parseWhatsAppMessages — voice distinction', () => {
  it('sets metadata.voice=true for voice notes', async () => {
    const payload = makePayload([
      {
        from: '14155551234',
        id: 'msg_voice',
        timestamp: '1700000000',
        type: 'audio',
        audio: { id: 'media_1', mime_type: 'audio/ogg; codecs=opus', voice: true },
      },
    ]);

    const events = await parseWhatsAppMessages(payload, null);
    const event = events[0] as MessageReceivedEvent;
    expect(event.metadata?.voice).toBe(true);
  });

  it('does not set metadata.voice for regular audio', async () => {
    const payload = makePayload([
      {
        from: '14155551234',
        id: 'msg_audio',
        timestamp: '1700000000',
        type: 'audio',
        audio: { id: 'media_2', mime_type: 'audio/mp4' },
      },
    ]);

    const events = await parseWhatsAppMessages(payload, null);
    const event = events[0] as MessageReceivedEvent;
    expect(event.metadata?.voice).toBeUndefined();
  });
});

// ─── parseWhatsAppMessages — sticker animation ───────────────────────

describe('parseWhatsAppMessages — sticker animation', () => {
  it('sets metadata.animated=true for animated stickers', async () => {
    const payload = makePayload([
      {
        from: '14155551234',
        id: 'msg_anim',
        timestamp: '1700000000',
        type: 'sticker',
        sticker: { id: 'media_3', mime_type: 'image/webp', animated: true },
      },
    ]);

    const events = await parseWhatsAppMessages(payload, null);
    const event = events[0] as MessageReceivedEvent;
    expect(event.metadata?.sticker).toBe(true);
    expect(event.metadata?.animated).toBe(true);
  });

  it('does not set metadata.animated for static stickers', async () => {
    const payload = makePayload([
      {
        from: '14155551234',
        id: 'msg_static',
        timestamp: '1700000000',
        type: 'sticker',
        sticker: { id: 'media_4', mime_type: 'image/webp' },
      },
    ]);

    const events = await parseWhatsAppMessages(payload, null);
    const event = events[0] as MessageReceivedEvent;
    expect(event.metadata?.sticker).toBe(true);
    expect(event.metadata?.animated).toBeUndefined();
  });
});

// ─── parseWhatsAppEchoes ─────────────────────────────────────────────

describe('parseWhatsAppEchoes', () => {
  it('extracts echo messages (from === phone_number_id)', async () => {
    const phoneNumberId = 'pn_business_123';
    const payload = makePayload(
      [
        {
          from: phoneNumberId,
          id: 'echo_msg_1',
          timestamp: '1700000000',
          type: 'text',
          text: { body: 'Hello customer' },
        },
      ],
      phoneNumberId,
    );

    const events = await parseWhatsAppEchoes(payload, null);
    expect(events).toHaveLength(1);
    const event = events[0] as MessageReceivedEvent;
    expect(event.type).toBe('message_received');
    expect(event.metadata?.echo).toBe(true);
    expect(event.metadata?.echoSource).toBe('business_app');
    expect(event.metadata?.direction).toBe('outbound');
  });

  it('ignores non-echo messages (from !== phone_number_id)', async () => {
    const payload = makePayload(
      [
        {
          from: '14155551234',
          id: 'regular_msg',
          timestamp: '1700000000',
          type: 'text',
          text: { body: 'Hi' },
        },
      ],
      'pn_business_123',
    );

    const events = await parseWhatsAppEchoes(payload, null);
    expect(events).toHaveLength(0);
  });

  it('returns empty array for non-whatsapp payloads', async () => {
    const payload = { object: 'not_whatsapp', entry: [] } as unknown as WhatsAppWebhookPayload;
    const events = await parseWhatsAppEchoes(payload, null);
    expect(events).toHaveLength(0);
  });
});

// ─── parseWhatsAppContactUpdates ─────────────────────────────────────

describe('parseWhatsAppContactUpdates', () => {
  it('parses account_update contact changes', () => {
    const payload: WhatsAppWebhookPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry_1',
          changes: [
            {
              field: 'account_update',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+1234567890',
                  phone_number_id: 'pn_123',
                },
                contacts: [
                  {
                    action: 'add',
                    wa_id: '5511987654321',
                    profile: { name: 'Alice' },
                  } as unknown as { profile: { name: string }; wa_id: string },
                ],
              },
            },
          ],
        },
      ],
    };

    const events = parseWhatsAppContactUpdates(payload);
    expect(events).toHaveLength(1);
    const event = events[0] as MessageReceivedEvent;
    expect(event.type).toBe('message_received');
    expect(event.metadata?.contactUpdate).toMatchObject({
      action: 'add',
      contact: { wa_id: '5511987654321' },
    });
  });

  it('ignores non-account_update changes', () => {
    const payload = makePayload([]);
    const events = parseWhatsAppContactUpdates(payload);
    expect(events).toHaveLength(0);
  });
});
