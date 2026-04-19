import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, mock } from 'bun:test'
import type { Message } from '@server/contracts/domain-types'

mock.module('@/components/ai-elements/conversation', () => ({
  Conversation: ({ children }: { children: React.ReactNode }) => <div data-testid="conversation">{children}</div>,
  ConversationContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

mock.module('@/components/ai-elements/message', () => ({
  Message: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageResponse: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="streamdown">{children}</div>
  ),
}))

mock.module('@/components/ai-elements/suggestion', () => ({
  Suggestion: ({ suggestion }: { suggestion: string }) => (
    <button type="button">{suggestion}</button>
  ),
  Suggestions: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

mock.module('@/components/card-actions', () => ({
  postCardReply: mock(() => Promise.resolve()),
  CardActions: () => null,
}))

import { MessageThread } from '../message-thread'

const textMsg: Message = {
  id: 'msg-1',
  conversationId: 'conv-1',
  tenantId: 'tenant-1',
  role: 'customer',
  kind: 'text',
  content: { text: 'Hello world' },
  parentMessageId: null,
  channelExternalId: null,
  status: null,
  createdAt: new Date(),
}

const agentCardMsg: Message = {
  id: 'msg-2',
  conversationId: 'conv-1',
  tenantId: 'tenant-1',
  role: 'agent',
  kind: 'card',
  content: {
    card: {
      title: 'Choose plan',
      children: [
        {
          type: 'actions',
          buttons: [
            { type: 'button', id: 'btn-basic', label: 'Basic', value: 'basic' },
            { type: 'button', id: 'btn-pro', label: 'Pro', value: 'pro' },
          ],
        },
      ],
    },
  },
  parentMessageId: null,
  channelExternalId: null,
  status: null,
  createdAt: new Date(),
}

describe('MessageThread', () => {
  it('renders text message via MessageResponse (Streamdown)', () => {
    const html = renderToStaticMarkup(<MessageThread messages={[textMsg]} />)
    expect(html).toContain('Hello world')
    expect(html).toContain('data-testid="streamdown"')
  })

  it('renders card message title via MessageCard', () => {
    const html = renderToStaticMarkup(<MessageThread messages={[agentCardMsg]} />)
    expect(html).toContain('Choose plan')
  })

  it('renders Suggestion chips for agent card actions', () => {
    const html = renderToStaticMarkup(<MessageThread messages={[agentCardMsg]} />)
    expect(html).toContain('Basic')
    expect(html).toContain('Pro')
  })

  it('does not render Suggestion chips for customer card messages', () => {
    const customerCard: Message = { ...agentCardMsg, id: 'msg-3', role: 'customer' }
    const html = renderToStaticMarkup(<MessageThread messages={[customerCard]} />)
    expect(html).not.toContain('<button')
  })

  it('renders both card and text in the same thread', () => {
    const html = renderToStaticMarkup(<MessageThread messages={[textMsg, agentCardMsg]} />)
    expect(html).toContain('Hello world')
    expect(html).toContain('Choose plan')
  })
})
