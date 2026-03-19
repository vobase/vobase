import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'bun:test';

import type {
  MessageReceivedEvent,
  ReactionEvent,
  StatusUpdateEvent,
} from '../../../contracts/channels';
import {
  _chunkText,
  createWhatsAppAdapter,
  WhatsAppApiError,
} from './whatsapp';

// ─── Test Helpers ────────────────────────────────────────────────────

const TEST_CONFIG = {
  phoneNumberId: '123456789',
  accessToken: 'test-access-token',
  appSecret: 'test-app-secret',
  apiVersion: 'v22.0',
};

function signPayload(payload: string, secret: string): string {
  const hmac = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  return `sha256=${hmac}`;
}

function makeWebhookRequest(payload: object, signature?: string): Request {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (signature !== undefined) headers['x-hub-signature-256'] = signature;
  return new Request('https://example.com/webhook', {
    method: 'POST',
    headers,
    body,
  });
}

function makeSignedWebhookRequest(payload: object): Request {
  const body = JSON.stringify(payload);
  const sig = signPayload(body, TEST_CONFIG.appSecret);
  return makeWebhookRequest(payload, sig);
}

function makeChallengeRequest(params: Record<string, string>): Request {
  const url = new URL('https://example.com/webhook');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new Request(url.toString(), { method: 'GET' });
}

function wrapPayload(value: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '16505555555',
                phone_number_id: 'PHONE_ID',
              },
              ...value,
            },
            field: 'messages',
          },
        ],
      },
    ],
  };
}

function makeMessagePayload(msg: Record<string, unknown>) {
  return wrapPayload({
    contacts: [{ profile: { name: 'John Doe' }, wa_id: '16315555555' }],
    messages: [
      {
        from: '16315555555',
        id: 'wamid.ABC123',
        timestamp: '1683229471',
        ...msg,
      },
    ],
  });
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(response: object, status = 200) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(response), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;
}

function mockFetchSequence(
  responses: Array<{ body: object; status?: number }>,
) {
  let callIndex = 0;
  globalThis.fetch = (async () => {
    const r = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    return new Response(JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('WhatsApp Adapter', () => {
  describe('verifyWebhook', () => {
    it('returns false for missing signature header', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      mockFetch({});
      const req = makeWebhookRequest({ test: true });
      expect(await adapter.verifyWebhook?.(req)).toBe(false);
    });

    it('returns false for empty signature', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      mockFetch({});
      const req = makeWebhookRequest({ test: true }, '');
      expect(await adapter.verifyWebhook?.(req)).toBe(false);
    });

    it('returns false for wrong prefix', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      mockFetch({});
      const req = makeWebhookRequest({ test: true }, 'md5=abc123');
      expect(await adapter.verifyWebhook?.(req)).toBe(false);
    });

    it('returns true for valid HMAC-SHA256 signature', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      mockFetch({});
      const payload = { object: 'whatsapp_business_account' };
      const body = JSON.stringify(payload);
      const sig = signPayload(body, TEST_CONFIG.appSecret);
      const req = makeWebhookRequest(payload, sig);
      expect(await adapter.verifyWebhook?.(req)).toBe(true);
    });

    it('returns false for tampered body', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      mockFetch({});
      const body = JSON.stringify({ original: true });
      const sig = signPayload(body, TEST_CONFIG.appSecret);
      // Create request with different body but original signature
      const req = new Request('https://example.com/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': sig,
        },
        body: JSON.stringify({ tampered: true }),
      });
      expect(await adapter.verifyWebhook?.(req)).toBe(false);
    });
  });

  describe('handleWebhookChallenge', () => {
    it('returns challenge for valid subscribe request', () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      const req = makeChallengeRequest({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'my-token',
        'hub.challenge': 'challenge_123',
      });
      const res = adapter.handleWebhookChallenge?.(req);
      expect(res).not.toBeNull();
      expect(res?.status).toBe(200);
    });

    it('returns null for missing hub.mode', () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      const req = makeChallengeRequest({
        'hub.verify_token': 'my-token',
        'hub.challenge': 'challenge_123',
      });
      expect(adapter.handleWebhookChallenge?.(req)).toBeNull();
    });

    it('returns null for missing hub.challenge', () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      const req = makeChallengeRequest({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'my-token',
      });
      expect(adapter.handleWebhookChallenge?.(req)).toBeNull();
    });

    it('returns null for non-subscribe mode', () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      const req = makeChallengeRequest({
        'hub.mode': 'unsubscribe',
        'hub.verify_token': 'my-token',
        'hub.challenge': 'challenge_123',
      });
      expect(adapter.handleWebhookChallenge?.(req)).toBeNull();
    });
  });

  describe('parseWebhook', () => {
    it('parses text message', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      const payload = makeMessagePayload({
        type: 'text',
        text: { body: 'Hello' },
      });
      const req = makeSignedWebhookRequest(payload);
      const events = (await adapter.parseWebhook?.(req)) ?? [];
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('message_received');
      const msg = events[0] as MessageReceivedEvent;
      expect(msg.content).toBe('Hello');
      expect(msg.messageType).toBe('text');
      expect(msg.from).toBe('16315555555');
      expect(msg.profileName).toBe('John Doe');
    });

    it('parses image message', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      // Mock media download: first call returns media URL, second downloads binary
      mockFetchSequence([
        {
          body: {
            url: 'https://media.example.com/img.jpg',
            mime_type: 'image/jpeg',
          },
        },
        { body: {} }, // binary response (simplified)
      ]);
      const payload = makeMessagePayload({
        type: 'image',
        image: { id: 'media_123', mime_type: 'image/jpeg', caption: 'A photo' },
      });
      const req = makeSignedWebhookRequest(payload);
      const events = (await adapter.parseWebhook?.(req)) ?? [];
      expect(events).toHaveLength(1);
      const msg = events[0] as MessageReceivedEvent;
      expect(msg.messageType).toBe('image');
      expect(msg.content).toBe('A photo');
    });

    it('parses document message', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      mockFetchSequence([
        {
          body: {
            url: 'https://media.example.com/doc.pdf',
            mime_type: 'application/pdf',
          },
        },
        { body: {} },
      ]);
      const payload = makeMessagePayload({
        type: 'document',
        document: {
          id: 'media_456',
          mime_type: 'application/pdf',
          filename: 'invoice.pdf',
        },
      });
      const req = makeSignedWebhookRequest(payload);
      const events = (await adapter.parseWebhook?.(req)) ?? [];
      expect(events).toHaveLength(1);
      expect((events[0] as MessageReceivedEvent).messageType).toBe('document');
    });

    it('parses audio message', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      mockFetchSequence([
        {
          body: {
            url: 'https://media.example.com/audio.ogg',
            mime_type: 'audio/ogg',
          },
        },
        { body: {} },
      ]);
      const payload = makeMessagePayload({
        type: 'audio',
        audio: { id: 'media_789', mime_type: 'audio/ogg; codecs=opus' },
      });
      const req = makeSignedWebhookRequest(payload);
      const events = (await adapter.parseWebhook?.(req)) ?? [];
      expect(events).toHaveLength(1);
      expect((events[0] as MessageReceivedEvent).messageType).toBe('audio');
    });

    it('parses video message', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      mockFetchSequence([
        {
          body: {
            url: 'https://media.example.com/video.mp4',
            mime_type: 'video/mp4',
          },
        },
        { body: {} },
      ]);
      const payload = makeMessagePayload({
        type: 'video',
        video: { id: 'media_101', mime_type: 'video/mp4' },
      });
      const req = makeSignedWebhookRequest(payload);
      const events = (await adapter.parseWebhook?.(req)) ?? [];
      expect(events).toHaveLength(1);
      expect((events[0] as MessageReceivedEvent).messageType).toBe('video');
    });

    it('parses location message', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      const payload = makeMessagePayload({
        type: 'location',
        location: {
          latitude: 18.4861,
          longitude: -69.9312,
          name: 'Santo Domingo',
          address: 'Av. Winston Churchill',
        },
      });
      const req = makeSignedWebhookRequest(payload);
      const events = (await adapter.parseWebhook?.(req)) ?? [];
      expect(events).toHaveLength(1);
      const msg = events[0] as MessageReceivedEvent;
      expect(msg.messageType).toBe('unsupported');
      expect(msg.content).toContain('Santo Domingo');
      expect(msg.content).toContain('18.4861');
      expect((msg.metadata?.location as Record<string, unknown>).latitude).toBe(
        18.4861,
      );
      expect(
        (msg.metadata?.location as Record<string, unknown>).longitude,
      ).toBe(-69.9312);
    });

    it('parses contacts message', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      const payload = makeMessagePayload({
        type: 'contacts',
        contacts: [
          {
            name: {
              formatted_name: 'Jane Smith',
              first_name: 'Jane',
              last_name: 'Smith',
            },
            phones: [{ phone: '+18091234567', type: 'CELL' }],
          },
        ],
      });
      const req = makeSignedWebhookRequest(payload);
      const events = (await adapter.parseWebhook?.(req)) ?? [];
      expect(events).toHaveLength(1);
      const msg = events[0] as MessageReceivedEvent;
      expect(msg.messageType).toBe('unsupported');
      expect(msg.content).toBe('Jane Smith');
      expect(msg.metadata?.contacts).toHaveLength(1);
    });

    it('parses sticker message', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      mockFetchSequence([
        {
          body: {
            url: 'https://media.example.com/sticker.webp',
            mime_type: 'image/webp',
          },
        },
        { body: {} },
      ]);
      const payload = makeMessagePayload({
        type: 'sticker',
        sticker: { id: 'media_sticker', mime_type: 'image/webp' },
      });
      const req = makeSignedWebhookRequest(payload);
      const events = (await adapter.parseWebhook?.(req)) ?? [];
      expect(events).toHaveLength(1);
      const msg = events[0] as MessageReceivedEvent;
      expect(msg.messageType).toBe('image');
      expect(msg.metadata?.sticker).toBe(true);
    });

    it('parses reaction', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      const payload = makeMessagePayload({
        type: 'reaction',
        reaction: { message_id: 'wamid.ORIGINAL', emoji: '\u{1F44D}' },
      });
      const req = makeSignedWebhookRequest(payload);
      const events = (await adapter.parseWebhook?.(req)) ?? [];
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('reaction');
      const r = events[0] as ReactionEvent;
      expect(r.emoji).toBe('\u{1F44D}');
      expect(r.messageId).toBe('wamid.ORIGINAL');
    });

    it('parses reaction removal (empty emoji)', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      const payload = makeMessagePayload({
        type: 'reaction',
        reaction: { message_id: 'wamid.ORIGINAL', emoji: '' },
      });
      const req = makeSignedWebhookRequest(payload);
      const events = (await adapter.parseWebhook?.(req)) ?? [];
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('reaction');
      expect((events[0] as ReactionEvent).emoji).toBe('');
    });

    it('parses button reply (interactive)', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      const payload = makeMessagePayload({
        type: 'interactive',
        interactive: {
          type: 'button_reply',
          button_reply: { id: 'btn_yes', title: 'Yes' },
        },
      });
      const req = makeSignedWebhookRequest(payload);
      const events = (await adapter.parseWebhook?.(req)) ?? [];
      expect(events).toHaveLength(1);
      const msg = events[0] as MessageReceivedEvent;
      expect(msg.messageType).toBe('button_reply');
      expect(msg.content).toBe('Yes');
      expect(msg.metadata?.buttonId).toBe('btn_yes');
    });

    it('parses list reply (interactive)', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      const payload = makeMessagePayload({
        type: 'interactive',
        interactive: {
          type: 'list_reply',
          list_reply: {
            id: 'option_1',
            title: 'Option 1',
            description: 'First option',
          },
        },
      });
      const req = makeSignedWebhookRequest(payload);
      const events = (await adapter.parseWebhook?.(req)) ?? [];
      expect(events).toHaveLength(1);
      const msg = events[0] as MessageReceivedEvent;
      expect(msg.messageType).toBe('list_reply');
      expect(msg.content).toBe('Option 1');
      expect(msg.metadata?.listId).toBe('option_1');
    });

    it('parses button (template quick reply)', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      const payload = makeMessagePayload({
        type: 'button',
        button: { text: 'Yes, confirm', payload: 'CONFIRM_ORDER_123' },
      });
      const req = makeSignedWebhookRequest(payload);
      const events = (await adapter.parseWebhook?.(req)) ?? [];
      expect(events).toHaveLength(1);
      const msg = events[0] as MessageReceivedEvent;
      expect(msg.messageType).toBe('button_reply');
      expect(msg.content).toBe('Yes, confirm');
      expect(msg.metadata?.buttonPayload).toBe('CONFIRM_ORDER_123');
    });

    it('handles unsupported message type', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      const payload = makeMessagePayload({ type: 'order' });
      const req = makeSignedWebhookRequest(payload);
      const events = (await adapter.parseWebhook?.(req)) ?? [];
      expect(events).toHaveLength(1);
      expect((events[0] as MessageReceivedEvent).messageType).toBe(
        'unsupported',
      );
    });

    it('parses sent status', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      const payload = wrapPayload({
        statuses: [
          {
            id: 'wamid.XXX',
            status: 'sent',
            timestamp: '1638420000',
            recipient_id: '16315551234',
          },
        ],
      });
      const req = makeSignedWebhookRequest(payload);
      const events = (await adapter.parseWebhook?.(req)) ?? [];
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('status_update');
      expect((events[0] as StatusUpdateEvent).status).toBe('sent');
    });

    it('parses delivered status', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      const payload = wrapPayload({
        statuses: [
          {
            id: 'wamid.XXX',
            status: 'delivered',
            timestamp: '1638420000',
            recipient_id: '16315551234',
          },
        ],
      });
      const req = makeSignedWebhookRequest(payload);
      const events = (await adapter.parseWebhook?.(req)) ?? [];
      expect(events).toHaveLength(1);
      expect((events[0] as StatusUpdateEvent).status).toBe('delivered');
    });

    it('parses read status', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      const payload = wrapPayload({
        statuses: [
          {
            id: 'wamid.XXX',
            status: 'read',
            timestamp: '1638420000',
            recipient_id: '16315551234',
          },
        ],
      });
      const req = makeSignedWebhookRequest(payload);
      const events = (await adapter.parseWebhook?.(req)) ?? [];
      expect(events).toHaveLength(1);
      expect((events[0] as StatusUpdateEvent).status).toBe('read');
    });

    it('parses failed status with errors', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      const payload = wrapPayload({
        statuses: [
          {
            id: 'wamid.XXX',
            status: 'failed',
            timestamp: '1638420000',
            recipient_id: '16315551234',
            errors: [{ code: 131047, title: 'Re-engagement message' }],
          },
        ],
      });
      const req = makeSignedWebhookRequest(payload);
      const events = (await adapter.parseWebhook?.(req)) ?? [];
      expect(events).toHaveLength(1);
      const evt = events[0] as StatusUpdateEvent;
      expect(evt.status).toBe('failed');
      expect(evt.metadata?.errors).toHaveLength(1);
      expect(
        (evt.metadata?.errors as Array<Record<string, unknown>>)[0].code,
      ).toBe(131047);
    });

    it('parses deleted status', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      const payload = wrapPayload({
        statuses: [
          {
            id: 'wamid.XXX',
            status: 'deleted',
            timestamp: '1638420000',
            recipient_id: '16315551234',
          },
        ],
      });
      const req = makeSignedWebhookRequest(payload);
      const events = (await adapter.parseWebhook?.(req)) ?? [];
      expect(events).toHaveLength(1);
      const evt = events[0] as StatusUpdateEvent;
      // 'deleted' is mapped to 'failed' since our contract only has sent/delivered/read/failed
      expect(evt.status).toBe('failed');
      expect(evt.metadata?.deleted).toBe(true);
    });

    it('handles empty entry array', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      const payload = { object: 'whatsapp_business_account', entry: [] };
      const req = makeSignedWebhookRequest(payload);
      const events = (await adapter.parseWebhook?.(req)) ?? [];
      expect(events).toHaveLength(0);
    });

    it('handles missing messages and statuses', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      const payload = wrapPayload({});
      const req = makeSignedWebhookRequest(payload);
      const events = (await adapter.parseWebhook?.(req)) ?? [];
      expect(events).toHaveLength(0);
    });

    it('handles malformed JSON gracefully', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      const req = new Request('https://example.com/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json {{{',
      });
      const events = (await adapter.parseWebhook?.(req)) ?? [];
      expect(events).toHaveLength(0);
    });

    it('deduplicates recently sent messages', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      // First, send a message to register its ID
      mockFetch({
        messaging_product: 'whatsapp',
        messages: [{ id: 'wamid.SENT_MSG' }],
      });
      await adapter.send({ to: '16315555555', text: 'Hello' });

      // Now try to parse a webhook with the same message ID as inbound
      const payload = wrapPayload({
        contacts: [{ profile: { name: 'John Doe' }, wa_id: '16315555555' }],
        messages: [
          {
            from: '16315555555',
            id: 'wamid.SENT_MSG',
            timestamp: '1683229471',
            type: 'text',
            text: { body: 'Echo' },
          },
        ],
      });
      const req = makeSignedWebhookRequest(payload);
      const events = (await adapter.parseWebhook?.(req)) ?? [];
      expect(events).toHaveLength(0);
    });
  });

  describe('send', () => {
    it('sends text message', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      mockFetch({
        messaging_product: 'whatsapp',
        messages: [{ id: 'wamid.OUT1' }],
      });
      const result = await adapter.send({
        to: '16315555555',
        text: 'Hello there',
      });
      expect(result.success).toBe(true);
      expect(result.messageId).toBe('wamid.OUT1');
    });

    it('chunks long text messages', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      let callCount = 0;
      globalThis.fetch = (async () => {
        callCount++;
        return new Response(
          JSON.stringify({
            messaging_product: 'whatsapp',
            messages: [{ id: `wamid.CHUNK${callCount}` }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }) as unknown as typeof fetch;

      const longText = `${'A'.repeat(4096)}\n\n${'B'.repeat(100)}`;
      const result = await adapter.send({ to: '16315555555', text: longText });
      expect(result.success).toBe(true);
      expect(callCount).toBe(2);
    });

    it('handles exactly MAX_TEXT_LENGTH text', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      let callCount = 0;
      globalThis.fetch = (async () => {
        callCount++;
        return new Response(
          JSON.stringify({
            messaging_product: 'whatsapp',
            messages: [{ id: 'wamid.EXACT' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }) as unknown as typeof fetch;

      const exactText = 'X'.repeat(4096);
      const result = await adapter.send({ to: '16315555555', text: exactText });
      expect(result.success).toBe(true);
      expect(callCount).toBe(1);
    });

    it('returns error for empty text', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      const result = await adapter.send({ to: '16315555555', text: '' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('sends template message', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      mockFetch({
        messaging_product: 'whatsapp',
        messages: [{ id: 'wamid.TMPL1' }],
      });
      const result = await adapter.send({
        to: '16315555555',
        template: {
          name: 'hello_world',
          language: 'en_US',
          parameters: ['John'],
        },
      });
      expect(result.success).toBe(true);
      expect(result.messageId).toBe('wamid.TMPL1');
    });

    it('sends interactive buttons', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      mockFetch({
        messaging_product: 'whatsapp',
        messages: [{ id: 'wamid.INT1' }],
      });
      const result = await adapter.send({
        to: '16315555555',
        metadata: {
          interactive: {
            type: 'button',
            body: { text: 'Choose one' },
            action: {
              buttons: [
                { type: 'reply', reply: { id: 'btn_1', title: 'Option 1' } },
              ],
            },
          },
        },
      });
      expect(result.success).toBe(true);
    });

    it('sends media with URL', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      mockFetch({
        messaging_product: 'whatsapp',
        messages: [{ id: 'wamid.MEDIA1' }],
      });
      const result = await adapter.send({
        to: '16315555555',
        media: [
          {
            type: 'image',
            url: 'https://example.com/photo.jpg',
            caption: 'A photo',
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('returns error for media without url or data', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      const result = await adapter.send({
        to: '16315555555',
        media: [{ type: 'image' }],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('neither url nor data');
    });

    it('uploads media with data then sends', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      mockFetchSequence([
        // Upload response
        { body: { id: 'uploaded_media_123' } },
        // Send response
        {
          body: {
            messaging_product: 'whatsapp',
            messages: [{ id: 'wamid.UPLOADED1' }],
          },
        },
      ]);
      const result = await adapter.send({
        to: '16315555555',
        media: [
          {
            type: 'image',
            data: Buffer.from('fake-image-data'),
            mimeType: 'image/jpeg',
          },
        ],
      });
      expect(result.success).toBe(true);
      expect(result.messageId).toBe('wamid.UPLOADED1');
    });

    it('includes replyToMessageId in context', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      let capturedBody: Record<string, unknown> | undefined;
      globalThis.fetch = (async (_url: string, opts: RequestInit) => {
        capturedBody = JSON.parse(opts.body as string) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            messaging_product: 'whatsapp',
            messages: [{ id: 'wamid.REPLY1' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }) as unknown as typeof fetch;

      await adapter.send({
        to: '16315555555',
        text: 'Reply text',
        metadata: { replyToMessageId: 'wamid.ORIGINAL' },
      });
      expect((capturedBody as Record<string, unknown>).context).toEqual({ message_id: 'wamid.ORIGINAL' });
    });
  });

  describe('errorToSendResult', () => {
    // We test error mapping by sending a message that triggers a mocked error response
    async function sendWithError(metaCode: number, httpStatus = 400) {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      mockFetch(
        {
          error: {
            message: `Error ${metaCode}`,
            type: 'OAuthException',
            code: metaCode,
            fbtrace_id: 'trace123',
          },
        },
        httpStatus,
      );
      return adapter.send({ to: '16315555555', text: 'test' });
    }

    it('maps 130429 to rate_limited (retryable)', async () => {
      const result = await sendWithError(130429);
      expect(result.code).toBe('rate_limited');
      expect(result.retryable).toBe(true);
    });

    it('maps 131056 to pair_rate_limited (retryable)', async () => {
      const result = await sendWithError(131056);
      expect(result.code).toBe('pair_rate_limited');
      expect(result.retryable).toBe(true);
    });

    it('maps 131030 to invalid_recipient (not retryable)', async () => {
      const result = await sendWithError(131030);
      expect(result.code).toBe('invalid_recipient');
      expect(result.retryable).toBe(false);
    });

    it('maps 131047 to window_expired (not retryable)', async () => {
      const result = await sendWithError(131047);
      expect(result.code).toBe('window_expired');
      expect(result.retryable).toBe(false);
    });

    it('maps 131050 to opted_out (not retryable)', async () => {
      const result = await sendWithError(131050);
      expect(result.code).toBe('opted_out');
      expect(result.retryable).toBe(false);
    });

    it('maps 132000 to template_param_mismatch (not retryable)', async () => {
      const result = await sendWithError(132000);
      expect(result.code).toBe('template_param_mismatch');
      expect(result.retryable).toBe(false);
    });

    it('maps 132012 to template_not_found (not retryable)', async () => {
      const result = await sendWithError(132012);
      expect(result.code).toBe('template_not_found');
      expect(result.retryable).toBe(false);
    });

    it('maps 131051 to unsupported_type (not retryable)', async () => {
      const result = await sendWithError(131051);
      expect(result.code).toBe('unsupported_type');
      expect(result.retryable).toBe(false);
    });

    it('maps 132015 to template_paused (not retryable)', async () => {
      const result = await sendWithError(132015);
      expect(result.code).toBe('template_paused');
      expect(result.retryable).toBe(false);
    });

    it('maps 133010 to not_registered (not retryable)', async () => {
      const result = await sendWithError(133010);
      expect(result.code).toBe('not_registered');
      expect(result.retryable).toBe(false);
    });

    it('maps 190 to invalid_token (not retryable)', async () => {
      const result = await sendWithError(190);
      expect(result.code).toBe('invalid_token');
      expect(result.retryable).toBe(false);
    });

    it('maps 5xx to server_error (retryable)', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      mockFetch({ error: { message: 'Internal', code: 0 } }, 500);
      const result = await adapter.send({ to: '16315555555', text: 'test' });
      expect(result.code).toBe('server_error');
      expect(result.retryable).toBe(true);
    });

    it('maps unknown error to retryable by default', async () => {
      const result = await sendWithError(999999);
      expect(result.code).toBe('unknown');
      expect(result.retryable).toBe(true);
    });
  });

  describe('chunkText', () => {
    it('returns single chunk for text under limit', () => {
      const result = _chunkText('Hello world');
      expect(result).toEqual(['Hello world']);
    });

    it('returns single chunk for text exactly at limit', () => {
      const text = 'X'.repeat(4096);
      const result = _chunkText(text);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(text);
    });

    it('splits at paragraph breaks', () => {
      const text = `${'A'.repeat(4000)}\n\n${'B'.repeat(200)}`;
      const result = _chunkText(text);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe('A'.repeat(4000));
      expect(result[1]).toBe('B'.repeat(200));
    });

    it('splits at line breaks when no paragraph break', () => {
      const text = `${'A'.repeat(4000)}\n${'B'.repeat(200)}`;
      const result = _chunkText(text);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe('A'.repeat(4000));
      expect(result[1]).toBe('B'.repeat(200));
    });

    it('hard cuts when no line breaks', () => {
      const text = 'A'.repeat(5000);
      const result = _chunkText(text);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe('A'.repeat(4096));
      expect(result[1]).toBe('A'.repeat(904));
    });

    it('handles empty string', () => {
      const result = _chunkText('');
      expect(result).toEqual(['']);
    });

    it('handles very long single word', () => {
      const text = 'A'.repeat(10000);
      const result = _chunkText(text);
      expect(result.length).toBeGreaterThan(1);
      expect(result.join('')).toBe(text);
    });

    it('trims leading newlines from chunks', () => {
      const text = `${'A'.repeat(4000)}\n\n\n\n${'B'.repeat(200)}`;
      const result = _chunkText(text);
      expect(result).toHaveLength(2);
      expect(result[1].startsWith('\n')).toBe(false);
    });
  });

  describe('markAsRead', () => {
    it('sends read status to Graph API', async () => {
      const adapter = createWhatsAppAdapter(TEST_CONFIG);
      let capturedBody: Record<string, unknown> | undefined;
      globalThis.fetch = (async (_url: string, opts: RequestInit) => {
        capturedBody = JSON.parse(opts.body as string) as Record<string, unknown>;
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as unknown as typeof fetch;

      await adapter.markAsRead('wamid.MSG123');
      expect(capturedBody).toEqual({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: 'wamid.MSG123',
      });
    });
  });

  describe('WhatsAppApiError', () => {
    it('carries structured error fields', () => {
      const err = new WhatsAppApiError(
        'Test error',
        400,
        131047,
        2494075,
        'trace123',
      );
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('WhatsAppApiError');
      expect(err.code).toBe(131047);
      expect(err.errorSubcode).toBe(2494075);
      expect(err.fbtraceId).toBe('trace123');
      expect(err.httpStatus).toBe(400);
    });
  });
});
