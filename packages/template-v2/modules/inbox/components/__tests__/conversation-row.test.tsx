import { describe, expect, it } from 'bun:test'
import type { Conversation } from '@server/contracts/domain-types'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConversationRow } from '../conversation-row'

const base: Conversation = {
  id: 'conv-1',
  tenantId: 't1',
  contactId: 'ct-abc',
  channelInstanceId: 'ch-whatsapp',
  status: 'active',
  assignee: 'unassigned',
  snoozedUntil: null,
  snoozedReason: null,
  snoozedBy: null,
  snoozedAt: null,
  snoozedJobId: null,
  threadKey: 'default',
  emailSubject: null,
  lastMessageAt: null,
  resolvedAt: null,
  resolvedReason: null,
  createdAt: new Date('2024-01-15T09:00:00Z'),
  updatedAt: new Date('2024-01-15T10:00:00Z'),
}

const statuses: Conversation['status'][] = ['active', 'resolving', 'resolved', 'awaiting_approval', 'failed']

describe('ConversationRow', () => {
  for (const status of statuses) {
    it(`snapshot: status=${status}`, () => {
      const html = renderToStaticMarkup(
        <ConversationRow conversation={{ ...base, status }} isSelected={false} onClick={() => {}} />,
      )
      expect(html).toMatchSnapshot()
    })
  }

  it('shows AvatarGroup when assignee is set', () => {
    const html = renderToStaticMarkup(
      <ConversationRow conversation={{ ...base, assignee: 'agent-smith' }} isSelected={false} onClick={() => {}} />,
    )
    expect(html).toContain('data-slot="avatar-group"')
  })

  it('does not show AvatarGroup when unassigned', () => {
    const html = renderToStaticMarkup(
      <ConversationRow conversation={{ ...base, assignee: 'unassigned' }} isSelected={false} onClick={() => {}} />,
    )
    expect(html).not.toContain('data-slot="avatar-group"')
  })

  it('applies selected state via aria-selected', () => {
    const html = renderToStaticMarkup(<ConversationRow conversation={base} isSelected onClick={() => {}} />)
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('bg-[var(--color-surface-elevated)]')
  })

  it('bolds contact name when selected', () => {
    const html = renderToStaticMarkup(<ConversationRow conversation={base} isSelected onClick={() => {}} />)
    expect(html).toContain('font-medium')
  })

  it('uses compact py-2 px-3 layout for ~44px height', () => {
    const html = renderToStaticMarkup(<ConversationRow conversation={base} isSelected={false} onClick={() => {}} />)
    expect(html).toContain('py-2')
    expect(html).toContain('px-3')
  })

  it('shows single-line preview via line-clamp-1', () => {
    const html = renderToStaticMarkup(<ConversationRow conversation={base} isSelected={false} onClick={() => {}} />)
    expect(html).toContain('line-clamp-1')
  })

  it('renders snooze indicator when snoozedUntil is in the future', () => {
    const snoozed = {
      ...base,
      snoozedUntil: new Date(Date.now() + 3600_000),
    }
    const html = renderToStaticMarkup(<ConversationRow conversation={snoozed} isSelected={false} onClick={() => {}} />)
    expect(html).toContain('conversation-row-snoozed')
  })

  it('does not render snooze indicator when snoozedUntil is in the past', () => {
    const snoozed = {
      ...base,
      snoozedUntil: new Date(Date.now() - 3600_000),
    }
    const html = renderToStaticMarkup(<ConversationRow conversation={snoozed} isSelected={false} onClick={() => {}} />)
    expect(html).not.toContain('conversation-row-snoozed')
  })
})
