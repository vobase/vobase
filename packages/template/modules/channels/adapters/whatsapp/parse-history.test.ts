/**
 * Unit tests for `parseWhatsAppHistory` — the pure transform from a coexistence
 * `history` webhook payload into backfill-ready message descriptors. Driven by
 * Meta's official example payloads (onboarding-business-app-users docs) as
 * fixtures, so the parser is pinned to the documented wire shape. Designed for
 * later extraction to `@vobase/core`.
 */
import { describe, expect, it } from 'bun:test'

import { parseHistoryMediaAssets, parseWhatsAppHistory } from './parse-history'

// Meta's official "chat history sharing approved" example: two threads — a
// text + media_placeholder + customer reply, and a thank-you to a second user.
const APPROVED_EXAMPLE = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '102290129340398',
      changes: [
        {
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15550783881', phone_number_id: '106540352242922' },
            history: [
              {
                metadata: { phase: 0, chunk_order: 1, progress: 55 },
                threads: [
                  {
                    id: '16505551234',
                    messages: [
                      {
                        from: '15550783881',
                        id: 'wamid.HBgLMTY0NjcwNDM1OTUVAgARGBIyNDlBOEI5QUQ4NDc0N0FCNjMA',
                        timestamp: '1739230955',
                        type: 'text',
                        text: { body: "Here's the info you requested! https://www.meta.com/quest/quest-3/" },
                        history_context: { status: 'READ' },
                      },
                      {
                        from: '15550783881',
                        id: 'wamid.QyNUEHBgLMTY0NjcwNDM1OTUVAgARGBI1Rj3NEYxMzAzMzQ5MkEA',
                        timestamp: '1739230970',
                        type: 'media_placeholder',
                        history_context: { status: 'PLAYED' },
                      },
                      {
                        from: '16505551234',
                        id: 'wamid.N0FCNjMAHBgLMTY0NjcwNDM1OTUVAgARGBIyNDlBOEI5QUQ4NDc0',
                        timestamp: '1739230970',
                        type: 'text',
                        text: { body: 'Thanks!' },
                        history_context: { status: 'READ' },
                      },
                    ],
                  },
                  {
                    id: '12125557890',
                    messages: [
                      {
                        from: '15550783881',
                        id: 'wamid.BIyNDlBOEI5N0FCNjMAHBgLMTY0NjcwNDM1OTUVAgARGQUQ4NDc0',
                        timestamp: '1739230970',
                        type: 'text',
                        text: {
                          body: 'Thanks for your order! As a thank you, use code THANKS30 to get 30% of your next order.',
                        },
                        history_context: { status: 'DELIVERED' },
                      },
                    ],
                  },
                ],
              },
            ],
          },
          field: 'history',
        },
      ],
    },
  ],
}

describe('parseWhatsAppHistory', () => {
  it('parses the official approved example into one chunk with flattened, directioned messages', () => {
    const chunks = parseWhatsAppHistory(APPROVED_EXAMPLE)

    expect(chunks).toHaveLength(1)
    const chunk = chunks[0]
    expect(chunk.phase).toBe(0)
    expect(chunk.chunkOrder).toBe(1)
    expect(chunk.progress).toBe(55)
    expect(chunk.declined).toBe(false)
    expect(chunk.businessPhone).toBe('15550783881')
    expect(chunk.phoneNumberId).toBe('106540352242922')

    expect(chunk.messages).toEqual([
      {
        customerPhone: '16505551234',
        wamid: 'wamid.HBgLMTY0NjcwNDM1OTUVAgARGBIyNDlBOEI5QUQ4NDc0N0FCNjMA',
        timestampMs: 1739230955000,
        direction: 'outbound',
        messageType: 'text',
        content: "Here's the info you requested! https://www.meta.com/quest/quest-3/",
        status: 'READ',
        isMediaPlaceholder: false,
      },
      {
        customerPhone: '16505551234',
        wamid: 'wamid.QyNUEHBgLMTY0NjcwNDM1OTUVAgARGBI1Rj3NEYxMzAzMzQ5MkEA',
        timestampMs: 1739230970000,
        direction: 'outbound',
        messageType: 'media_placeholder',
        content: '',
        status: 'PLAYED',
        isMediaPlaceholder: true,
      },
      {
        customerPhone: '16505551234',
        wamid: 'wamid.N0FCNjMAHBgLMTY0NjcwNDM1OTUVAgARGBIyNDlBOEI5QUQ4NDc0',
        timestampMs: 1739230970000,
        direction: 'inbound',
        messageType: 'text',
        content: 'Thanks!',
        status: 'READ',
        isMediaPlaceholder: false,
      },
      {
        customerPhone: '12125557890',
        wamid: 'wamid.BIyNDlBOEI5N0FCNjMAHBgLMTY0NjcwNDM1OTUVAgARGQUQ4NDc0',
        timestampMs: 1739230970000,
        direction: 'outbound',
        messageType: 'text',
        content: 'Thanks for your order! As a thank you, use code THANKS30 to get 30% of your next order.',
        status: 'DELIVERED',
        isMediaPlaceholder: false,
      },
    ])
  })

  it('marks a chunk declined with no messages when history sharing is turned off (2593109)', () => {
    const declined = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '102290129340398',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '15550783881', phone_number_id: '106540352242922' },
                history: [
                  {
                    errors: [
                      {
                        code: 2593109,
                        title: 'History sync is turned off by the business from the WhatsApp Business App',
                      },
                    ],
                  },
                ],
              },
              field: 'history',
            },
          ],
        },
      ],
    }

    const chunks = parseWhatsAppHistory(declined)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.declined).toBe(true)
    expect(chunks[0]?.messages).toEqual([])
  })

  it('uses the caption as content for a media message that carries one', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'W',
          changes: [
            {
              value: {
                metadata: { display_phone_number: '15550783881', phone_number_id: 'PN' },
                history: [
                  {
                    metadata: { phase: 1, chunk_order: 2, progress: 80 },
                    threads: [
                      {
                        id: '16505551234',
                        messages: [
                          {
                            from: '16505551234',
                            id: 'wamid.IMG',
                            timestamp: '1700000000',
                            type: 'image',
                            image: {
                              caption: 'Black Prince echeveria',
                              mime_type: 'image/jpeg',
                              id: '24230790383178626',
                            },
                            history_context: { status: 'DELIVERED' },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              field: 'history',
            },
          ],
        },
      ],
    }

    const [chunk] = parseWhatsAppHistory(payload)
    expect(chunk?.phase).toBe(1)
    expect(chunk?.messages[0]).toMatchObject({
      direction: 'inbound',
      messageType: 'image',
      content: 'Black Prince echeveria',
      isMediaPlaceholder: false,
    })
  })

  it('infers direction by digits only, tolerating +/space formatting differences', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'W',
          changes: [
            {
              field: 'history',
              value: {
                metadata: { display_phone_number: '15550783881', phone_number_id: 'PN' },
                history: [
                  {
                    metadata: { phase: 0, chunk_order: 1, progress: 100 },
                    threads: [
                      {
                        id: '16505551234',
                        messages: [
                          // Same business number, formatted with + and spaces — must still be outbound.
                          {
                            from: '+1 555 078 3881',
                            id: 'wamid.FMT',
                            timestamp: '1700000000',
                            type: 'text',
                            text: { body: 'formatted business number' },
                          },
                          {
                            from: '16505551234',
                            id: 'wamid.CUST',
                            timestamp: '1700000001',
                            type: 'text',
                            text: { body: 'hi' },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    }

    const [chunk] = parseWhatsAppHistory(payload)
    expect(chunk?.messages.find((m) => m.wamid === 'wamid.FMT')?.direction).toBe('outbound')
    expect(chunk?.messages.find((m) => m.wamid === 'wamid.CUST')?.direction).toBe('inbound')
  })

  it('returns [] for non-WABA, null, or non-history payloads', () => {
    expect(parseWhatsAppHistory(null)).toEqual([])
    expect(parseWhatsAppHistory({ object: 'page', entry: [] })).toEqual([])
    expect(
      parseWhatsAppHistory({
        object: 'whatsapp_business_account',
        entry: [{ changes: [{ field: 'messages', value: {} }] }],
      }),
    ).toEqual([])
  })

  it('drops WhatsApp errors-type entries (no content) but keeps real messages in the same thread', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'W',
          changes: [
            {
              field: 'history',
              value: {
                metadata: { display_phone_number: '6589765873', phone_number_id: 'PN' },
                history: [
                  {
                    metadata: { phase: 0, chunk_order: 1, progress: 100 },
                    threads: [
                      {
                        id: '447710173736',
                        messages: [
                          {
                            from: '447710173736',
                            id: 'wamid.ERR',
                            timestamp: '1780542125',
                            type: 'errors',
                            errors: [{ code: 131051, title: 'Message type unknown' }],
                          },
                          {
                            from: '447710173736',
                            id: 'wamid.TXT',
                            timestamp: '1780542130',
                            type: 'text',
                            text: { body: 'real message' },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    }

    const [chunk] = parseWhatsAppHistory(payload)
    expect(chunk?.messages).toHaveLength(1)
    expect(chunk?.messages[0]?.wamid).toBe('wamid.TXT')
    expect(chunk?.messages[0]?.content).toBe('real message')
  })
})

describe('parseHistoryMediaAssets', () => {
  it('parses the ≤14-day media-asset follow-up (messages[] under field:history)', () => {
    // Real captured shape (history-…764159.json).
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '1510232487148821',
          changes: [
            {
              field: 'history',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '6589765873', phone_number_id: '1184057261457861' },
                messages: [
                  {
                    from: '6589523447',
                    id: 'wamid.IMG',
                    timestamp: '1780544229',
                    type: 'image',
                    image: {
                      mime_type: 'image/jpeg',
                      sha256: 'abc',
                      id: '2446671352468659',
                      url: 'https://lookaside.fbsbx.com/x',
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    }

    expect(parseHistoryMediaAssets(payload)).toEqual([
      {
        wamid: 'wamid.IMG',
        mediaId: '2446671352468659',
        mediaType: 'image',
        mimeType: 'image/jpeg',
        filename: 'image-2446671352468659',
      },
    ])
  })

  it('returns [] for a history chunk with no media-asset messages', () => {
    expect(
      parseHistoryMediaAssets({
        object: 'whatsapp_business_account',
        entry: [{ changes: [{ field: 'history', value: { history: [{ metadata: { phase: 0 }, threads: [] }] } }] }],
      }),
    ).toEqual([])
  })
})
