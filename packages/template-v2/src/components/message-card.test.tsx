/**
 * MessageCard unit tests — render every CardElement variant via renderToString (no DOM needed).
 * Button-click payload test mocks globalThis.fetch and exercises postCardReply directly.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import type { Message } from '@server/contracts/domain-types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { postCardReply } from './card-actions'
import { MessageCard } from './message-card'

function withQuery(element: React.ReactElement) {
  const qc = new QueryClient()
  return React.createElement(QueryClientProvider, { client: qc }, element)
}

// Minimal Message factory
function makeMsg(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    conversationId: 'conv-1',
    organizationId: 'ten-1',
    role: 'agent',
    kind: 'text',
    content: { text: 'hello' },
    parentMessageId: null,
    channelExternalId: null,
    status: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  }
}

describe('MessageCard — text', () => {
  it('renders text content', () => {
    const html = renderToString(<MessageCard message={makeMsg({ kind: 'text', content: { text: 'Hello world' } })} />)
    expect(html).toContain('Hello world')
  })

  it('renders customer text in muted bubble', () => {
    const html = renderToString(
      <MessageCard message={makeMsg({ role: 'customer', kind: 'text', content: { text: 'Hi' } })} />,
    )
    expect(html).toContain('bg-muted')
  })

  it('renders agent text in primary bubble', () => {
    const html = renderToString(
      <MessageCard message={makeMsg({ role: 'agent', kind: 'text', content: { text: 'Howdy' } })} />,
    )
    expect(html).toContain('bg-primary')
  })
})

describe('MessageCard — card variants', () => {
  it('renders card title', () => {
    const html = renderToString(
      <MessageCard
        message={makeMsg({
          kind: 'card',
          content: { card: { title: 'Pricing Options', children: [] } },
        })}
      />,
    )
    expect(html).toContain('Pricing Options')
  })

  it('renders TextElement body style', () => {
    const html = renderToString(
      <MessageCard
        message={makeMsg({
          kind: 'card',
          content: { card: { children: [{ type: 'text', style: 'body', content: 'Body text here' }] } },
        })}
      />,
    )
    expect(html).toContain('Body text here')
  })

  it('renders TextElement heading style', () => {
    const html = renderToString(
      <MessageCard
        message={makeMsg({
          kind: 'card',
          content: { card: { children: [{ type: 'text', style: 'heading', content: 'Section Heading' }] } },
        })}
      />,
    )
    expect(html).toContain('Section Heading')
    expect(html).toContain('font-semibold')
  })

  it('renders TextElement caption style', () => {
    const html = renderToString(
      <MessageCard
        message={makeMsg({
          kind: 'card',
          content: { card: { children: [{ type: 'text', style: 'caption', content: 'Fine print' }] } },
        })}
      />,
    )
    expect(html).toContain('Fine print')
    expect(html).toContain('muted-foreground')
  })

  it('renders ImageElement with alt text when no url', () => {
    const html = renderToString(
      <MessageCard
        message={makeMsg({
          kind: 'card',
          content: { card: { children: [{ type: 'image', alt: 'Product photo' }] } },
        })}
      />,
    )
    expect(html).toContain('Product photo')
  })

  it('renders ImageElement with url as img tag', () => {
    const html = renderToString(
      <MessageCard
        message={makeMsg({
          kind: 'card',
          content: { card: { children: [{ type: 'image', url: 'https://example.com/img.png', alt: 'Alt' }] } },
        })}
      />,
    )
    expect(html).toContain('<img')
    expect(html).toContain('example.com/img.png')
  })

  it('renders DividerElement as hr', () => {
    const html = renderToString(
      <MessageCard
        message={makeMsg({
          kind: 'card',
          content: { card: { children: [{ type: 'divider' }] } },
        })}
      />,
    )
    expect(html).toContain('<hr')
  })

  it('renders FieldsElement as description list for ≤4 items', () => {
    const html = renderToString(
      <MessageCard
        message={makeMsg({
          kind: 'card',
          content: {
            card: {
              children: [
                {
                  type: 'fields',
                  items: [
                    { label: 'Plan', value: 'Pro' },
                    { label: 'Price', value: '$29/mo' },
                  ],
                },
              ],
            },
          },
        })}
      />,
    )
    expect(html).toContain('Plan')
    expect(html).toContain('Pro')
    expect(html).toContain('Price')
    expect(html).toContain('$29/mo')
    expect(html).toContain('<dl')
  })

  it('renders FieldsElement as table for ≥5 items', () => {
    const items = [
      { label: 'A', value: '1' },
      { label: 'B', value: '2' },
      { label: 'C', value: '3' },
      { label: 'D', value: '4' },
      { label: 'E', value: '5' },
    ]
    const html = renderToString(
      <MessageCard
        message={makeMsg({
          kind: 'card',
          content: { card: { children: [{ type: 'fields', items }] } },
        })}
      />,
    )
    expect(html).toContain('<table')
    expect(html).toContain('A')
    expect(html).toContain('5')
  })

  it('renders ActionsElement buttons', () => {
    const html = renderToString(
      withQuery(
        <MessageCard
          message={makeMsg({
            kind: 'card',
            content: {
              card: {
                children: [
                  {
                    type: 'actions',
                    buttons: [
                      { type: 'button', id: 'btn-yes', label: 'Yes', value: 'yes', style: 'primary' },
                      { type: 'button', id: 'btn-no', label: 'No', value: 'no', style: 'secondary' },
                    ],
                  },
                ],
              },
            },
          })}
        />,
      ),
    )
    expect(html).toContain('Yes')
    expect(html).toContain('No')
    expect(html).toContain('<button')
  })

  it('renders ActionsElement link_button as anchor', () => {
    const html = renderToString(
      withQuery(
        <MessageCard
          message={makeMsg({
            kind: 'card',
            content: {
              card: {
                children: [
                  {
                    type: 'actions',
                    buttons: [{ type: 'link_button', label: 'Learn more', url: 'https://example.com' }],
                  },
                ],
              },
            },
          })}
        />,
      ),
    )
    expect(html).toContain('Learn more')
    expect(html).toContain('<a')
    expect(html).toContain('example.com')
  })

  it('renders LinkElement as anchor', () => {
    const html = renderToString(
      <MessageCard
        message={makeMsg({
          kind: 'card',
          content: {
            card: {
              children: [{ type: 'link', label: 'Open docs', url: 'https://docs.example.com' }],
            },
          },
        })}
      />,
    )
    expect(html).toContain('Open docs')
    expect(html).toContain('docs.example.com')
  })
})

describe('MessageCard — card_reply', () => {
  it('renders card_reply with button label', () => {
    const html = renderToString(
      <MessageCard
        message={makeMsg({
          kind: 'card_reply',
          role: 'customer',
          content: { buttonLabel: 'Yes please', buttonId: 'btn-1', buttonValue: 'yes' },
        })}
      />,
    )
    expect(html).toContain('Yes please')
  })

  it('renders card_reply parent card title when parentMessage provided', () => {
    const parentCard = makeMsg({
      id: 'parent-card',
      kind: 'card',
      content: { card: { title: 'Choose a plan', children: [] } },
    })
    const reply = makeMsg({
      id: 'reply-1',
      kind: 'card_reply',
      role: 'customer',
      parentMessageId: 'parent-card',
      content: { buttonLabel: 'Pro', buttonId: 'btn-pro', buttonValue: 'pro' },
    })
    const html = renderToString(<MessageCard message={reply} parentMessage={parentCard} />)
    expect(html).toContain('Choose a plan')
    expect(html).toContain('Pro')
  })
})

describe('postCardReply — fetch payload', () => {
  afterEach(() => {
    // restore
    if ('restore' in globalThis.fetch) (globalThis.fetch as unknown as { restore: () => void }).restore()
  })

  it('posts correct JSON body to card-reply endpoint', async () => {
    const captured: { url: string; body: unknown }[] = []

    globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
      captured.push({ url, body: JSON.parse((init?.body as string) ?? '{}') })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as unknown as typeof fetch

    await postCardReply({ messageId: 'msg-42', buttonId: 'btn-yes', buttonValue: 'yes' })

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe('/api/channel-web/card-reply')
    expect(captured[0].body).toEqual({ messageId: 'msg-42', buttonId: 'btn-yes', buttonValue: 'yes' })
  })

  it('throws when response is not ok', async () => {
    globalThis.fetch = mock(async () => new Response('error', { status: 422 })) as unknown as typeof fetch
    await expect(postCardReply({ messageId: 'm', buttonId: 'b', buttonValue: 'v' })).rejects.toThrow('422')
  })
})
