import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Message } from '../../schema'

mock.module('@/components/ai-elements/conversation', () => ({
  Conversation: ({ children }: { children: React.ReactNode }) => <div data-testid="conversation">{children}</div>,
  ConversationContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

mock.module('@/components/ai-elements/message', () => ({
  Message: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageResponse: ({ children }: { children: React.ReactNode }) => <div data-testid="streamdown">{children}</div>,
}))

mock.module('@/components/ai-elements/suggestion', () => ({
  Suggestion: ({ suggestion }: { suggestion: string }) => <button type="button">{suggestion}</button>,
  Suggestions: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

mock.module('@/components/ai-elements/reasoning', () => ({
  Reasoning: ({ children }: { children: React.ReactNode }) => <div data-testid="reasoning">{children}</div>,
  ReasoningTrigger: () => <button type="button">Thinking...</button>,
  ReasoningContent: ({ children }: { children: string }) => <div data-testid="reasoning-content">{children}</div>,
}))

mock.module('@/components/ai-elements/task', () => ({
  Task: ({ children }: { children: React.ReactNode }) => <div data-testid="task">{children}</div>,
  TaskTrigger: ({ title }: { title: string }) => <div data-testid="task-trigger">{title}</div>,
  TaskContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TaskItem: ({ children }: { children: React.ReactNode }) => <div data-testid="task-item">{children}</div>,
}))

mock.module('@/components/card-actions', () => ({
  postCardReply: mock(() => Promise.resolve()),
  CardActions: ({ buttons }: { buttons: Array<{ id: string; label: string }> }) => (
    <div data-testid="card-actions">
      {buttons.map((b) => (
        <button key={b.id} type="button">
          {b.label}
        </button>
      ))}
    </div>
  ),
}))

import { MessageThread } from '../message-thread'

const textMsg: Message = {
  id: 'msg-1',
  conversationId: 'conv-1',
  organizationId: 'org-1',
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
  organizationId: 'org-1',
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

  it('renders card action buttons via MessageCard (no duplicate Suggestion chip row)', () => {
    const html = renderToStaticMarkup(<MessageThread messages={[agentCardMsg]} />)
    // Card action labels must appear exactly once (single button per action).
    expect(html).toContain('Basic')
    expect(html).toContain('Pro')
    expect((html.match(/>Basic</g) ?? []).length).toBe(1)
    expect((html.match(/>Pro</g) ?? []).length).toBe(1)
  })

  it('renders CardActions (not a separate Suggestions row) for customer card messages', () => {
    const customerCard: Message = { ...agentCardMsg, id: 'msg-3', role: 'customer' }
    const html = renderToStaticMarkup(<MessageThread messages={[customerCard]} />)
    // Customer cards still go through MessageCard → CardActions; they render buttons
    // but never a separate Suggestions chip row above them.
    expect(html).not.toContain('data-testid="suggestions"')
  })

  it('renders both card and text in the same thread', () => {
    const html = renderToStaticMarkup(<MessageThread messages={[textMsg, agentCardMsg]} />)
    expect(html).toContain('Hello world')
    expect(html).toContain('Choose plan')
  })

  it('renders Reasoning block when msg.reasoning is present on agent message', () => {
    const reasoningMsg = {
      ...textMsg,
      id: 'msg-r1',
      role: 'agent' as const,
      reasoning: 'I thought about this carefully.',
    }
    const html = renderToStaticMarkup(<MessageThread messages={[reasoningMsg]} />)
    expect(html).toContain('data-testid="reasoning"')
    expect(html).toContain('I thought about this carefully.')
  })

  it('renders Task component for task-list content payload', () => {
    const taskMsg: Message = {
      id: 'msg-t1',
      conversationId: 'conv-1',
      organizationId: 'org-1',
      role: 'agent',
      kind: 'text',
      content: {
        type: 'task',
        title: 'Processing your request',
        items: [
          { id: 'step-1', label: 'Search knowledge base' },
          { id: 'step-2', label: 'Generate response' },
        ],
      },
      parentMessageId: null,
      channelExternalId: null,
      status: null,
      createdAt: new Date(),
    }
    const html = renderToStaticMarkup(<MessageThread messages={[taskMsg]} />)
    expect(html).toContain('data-testid="task"')
    expect(html).toContain('Processing your request')
    expect(html).toContain('Search knowledge base')
    expect(html).not.toContain('data-testid="streamdown"')
  })
})
