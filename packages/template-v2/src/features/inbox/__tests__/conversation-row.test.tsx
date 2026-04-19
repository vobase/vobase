import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConversationRow } from '../conversation-row'
import type { Conversation } from '@server/contracts/domain-types'

const base: Conversation = {
  id: 'conv-1',
  tenantId: 't1',
  contactId: 'ct-abc',
  channelInstanceId: 'ch-whatsapp',
  parentConversationId: null,
  compactionSummary: 'Test preview text',
  compactedAt: null,
  status: 'active',
  assignee: 'unassigned',
  onHold: false,
  onHoldReason: null,
  lastMessageAt: null,
  resolvedAt: null,
  resolvedReason: null,
  createdAt: new Date('2024-01-15T09:00:00Z'),
  updatedAt: new Date('2024-01-15T10:00:00Z'),
}

const statuses: Conversation['status'][] = [
  'active', 'resolving', 'resolved', 'compacted', 'archived', 'awaiting_approval', 'failed',
]

describe('ConversationRow', () => {
  for (const status of statuses) {
    it(`snapshot: status=${status}`, () => {
      const html = renderToStaticMarkup(
        <ConversationRow
          conversation={{ ...base, status }}
          isSelected={false}
          onClick={() => {}}
        />,
      )
      expect(html).toMatchSnapshot()
    })
  }

  it('shows AvatarGroup when assignee is set', () => {
    const html = renderToStaticMarkup(
      <ConversationRow
        conversation={{ ...base, assignee: 'agent-smith' }}
        isSelected={false}
        onClick={() => {}}
      />,
    )
    expect(html).toContain('data-slot="avatar-group"')
  })

  it('does not show AvatarGroup when unassigned', () => {
    const html = renderToStaticMarkup(
      <ConversationRow
        conversation={{ ...base, assignee: 'unassigned' }}
        isSelected={false}
        onClick={() => {}}
      />,
    )
    expect(html).not.toContain('data-slot="avatar-group"')
  })

  it('applies selected state via aria-selected', () => {
    const html = renderToStaticMarkup(
      <ConversationRow conversation={base} isSelected onClick={() => {}} />,
    )
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('bg-[var(--color-surface-elevated)]')
  })

  it('bolds contact name when selected', () => {
    const html = renderToStaticMarkup(
      <ConversationRow conversation={base} isSelected onClick={() => {}} />,
    )
    expect(html).toContain('font-medium')
  })
})
