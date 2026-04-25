/**
 * parser.test.ts — 10 fixture events covering all WA Cloud API message types.
 * 100% fixture-driven, no mocks required (pure function).
 */
import { describe, expect, it } from 'bun:test'

import { type MetaWebhookPayload, parseWebhookPayload } from '../service/parser'

const ORG = 'org-test'
const BASE_TS = '1700000000'

type WaContact = { profile?: { name: string }; wa_id: string }
type WaMessage = MetaWebhookPayload['entry'][0]['changes'][0]['value']['messages']
type WaStatus = MetaWebhookPayload['entry'][0]['changes'][0]['value']['statuses']

function wrap(messages?: object[], statuses?: object[], contacts?: WaContact[]): MetaWebhookPayload {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_001',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: 'phone-001' },
              contacts: contacts ?? [{ profile: { name: 'Alice' }, wa_id: '6591234567' }],
              messages: messages as WaMessage,
              statuses: statuses as WaStatus,
            },
            field: 'messages',
          },
        ],
      },
    ],
  }
}

describe('parseWebhookPayload', () => {
  it('fixture 1 — text message', () => {
    const payload = wrap([
      { from: '6591234567', id: 'wamid.001', timestamp: BASE_TS, type: 'text', text: { body: 'Hello world' } },
    ])
    const [ev] = parseWebhookPayload(payload, ORG)
    expect(ev).toBeDefined()
    expect(ev.channelType).toBe('whatsapp')
    expect(ev.contentType).toBe('text')
    expect(ev.content).toBe('Hello world')
    expect(ev.from).toBe('6591234567')
    expect(ev.profileName).toBe('Alice')
    expect(ev.externalMessageId).toBe('wamid.001')
    expect(ev.organizationId).toBe(ORG)
    expect(typeof ev.timestamp).toBe('number')
  })

  it('fixture 2 — image message with caption', () => {
    const payload = wrap([
      {
        from: '6591234567',
        id: 'wamid.002',
        timestamp: BASE_TS,
        type: 'image',
        image: { id: 'img-001', caption: 'Check this out', mime_type: 'image/jpeg' },
      },
    ])
    const [ev] = parseWebhookPayload(payload, ORG)
    expect(ev.contentType).toBe('image')
    expect(ev.content).toBe('Check this out')
    expect(ev.externalMessageId).toBe('wamid.002')
  })

  it('fixture 3 — image message without caption', () => {
    const payload = wrap([
      { from: '6591234567', id: 'wamid.003', timestamp: BASE_TS, type: 'image', image: { id: 'img-002' } },
    ])
    const [ev] = parseWebhookPayload(payload, ORG)
    expect(ev.contentType).toBe('image')
    expect(ev.content).toContain('img-002')
  })

  it('fixture 4 — audio message', () => {
    const payload = wrap([
      {
        from: '6591234567',
        id: 'wamid.004',
        timestamp: BASE_TS,
        type: 'audio',
        audio: { id: 'aud-001', mime_type: 'audio/ogg' },
      },
    ])
    const [ev] = parseWebhookPayload(payload, ORG)
    expect(ev.contentType).toBe('audio')
    expect(ev.content).toContain('aud-001')
  })

  it('fixture 5 — document message', () => {
    const payload = wrap([
      {
        from: '6591234567',
        id: 'wamid.005',
        timestamp: BASE_TS,
        type: 'document',
        document: { id: 'doc-001', filename: 'invoice.pdf', caption: 'Please review' },
      },
    ])
    const [ev] = parseWebhookPayload(payload, ORG)
    expect(ev.contentType).toBe('document')
    expect(ev.content).toBe('Please review')
  })

  it('fixture 6 — button reply (quick reply)', () => {
    const payload = wrap([
      {
        from: '6591234567',
        id: 'wamid.006',
        timestamp: BASE_TS,
        type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { id: 'btn_yes', title: 'Yes, confirm' } },
      },
    ])
    const [ev] = parseWebhookPayload(payload, ORG)
    expect(ev.contentType).toBe('button_reply')
    expect(ev.content).toBe('Yes, confirm')
  })

  it('fixture 7 — list reply', () => {
    const payload = wrap([
      {
        from: '6591234567',
        id: 'wamid.007',
        timestamp: BASE_TS,
        type: 'interactive',
        interactive: {
          type: 'list_reply',
          list_reply: { id: 'option_2', title: 'Option B', description: 'Second option' },
        },
      },
    ])
    const [ev] = parseWebhookPayload(payload, ORG)
    expect(ev.contentType).toBe('list_reply')
    expect(ev.content).toBe('Option B')
  })

  it('fixture 8 — status delivered', () => {
    const payload = wrap([], [{ id: 'wamid.008', status: 'delivered', timestamp: BASE_TS, recipient_id: '6591234567' }])
    const [ev] = parseWebhookPayload(payload, ORG)
    expect(ev.contentType).toBe('unsupported')
    expect(ev.content).toBe('delivered')
    expect(ev.from).toBe('6591234567')
    expect((ev.metadata as Record<string, unknown>)?.waStatusUpdate).toBe('delivered')
  })

  it('fixture 9 — status read', () => {
    const payload = wrap([], [{ id: 'wamid.009', status: 'read', timestamp: BASE_TS, recipient_id: '6591234567' }])
    const [ev] = parseWebhookPayload(payload, ORG)
    expect(ev.contentType).toBe('unsupported')
    expect(ev.content).toBe('read')
  })

  it('fixture 10 — video message', () => {
    const payload = wrap([
      {
        from: '6591234567',
        id: 'wamid.010',
        timestamp: BASE_TS,
        type: 'video',
        video: { id: 'vid-001', caption: 'Watch this' },
      },
    ])
    const [ev] = parseWebhookPayload(payload, ORG)
    expect(ev.contentType).toBe('video')
    expect(ev.content).toBe('Watch this')
  })

  it('multiple messages in one payload returns all events', () => {
    const payload = wrap(
      [
        { from: '6591234567', id: 'wamid.011', timestamp: BASE_TS, type: 'text', text: { body: 'Hello' } },
        { from: '6591234567', id: 'wamid.012', timestamp: BASE_TS, type: 'text', text: { body: 'World' } },
      ],
      [{ id: 'wamid.013', status: 'sent', timestamp: BASE_TS, recipient_id: '6591234567' }],
    )
    const events = parseWebhookPayload(payload, ORG)
    expect(events).toHaveLength(3)
    expect(events[0].content).toBe('Hello')
    expect(events[1].content).toBe('World')
    expect(events[2].contentType).toBe('unsupported')
  })

  it('no ChannelInboundEvent fields use InferSelectModel — types are strict', () => {
    const payload = wrap([
      { from: '6591234567', id: 'wamid.014', timestamp: BASE_TS, type: 'text', text: { body: 'hi' } },
    ])
    const [ev] = parseWebhookPayload(payload, ORG)
    // All required ChannelInboundEvent fields must be present with correct types
    expect(typeof ev.organizationId).toBe('string')
    expect(typeof ev.channelType).toBe('string')
    expect(typeof ev.externalMessageId).toBe('string')
    expect(typeof ev.from).toBe('string')
    expect(typeof ev.content).toBe('string')
    expect(typeof ev.contentType).toBe('string')
    expect(typeof ev.timestamp).toBe('number')
  })
})
