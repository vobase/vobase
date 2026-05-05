/**
 * Unit tests for cardToOutbound — the send_card → OutboundMessage converter.
 *
 * No database required; cardToOutbound is a pure function.
 */
import { describe, expect, it } from 'bun:test'
import type { CardElement } from '@modules/messaging/tools/send-card'

import { cardToOutbound, WA_BUTTON_TITLE_MAX, WA_HEADER_MAX, WA_LIST_ROW_MAX, WA_ROW_TITLE_MAX } from './outbound'

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeCard(overrides: Partial<CardElement> = {}): CardElement {
  return {
    type: 'card',
    title: 'Test card',
    children: [{ type: 'text', content: 'Some body text.' }],
    ...overrides,
  }
}

function makeButtons(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    type: 'button' as const,
    id: `btn_${i + 1}`,
    label: `Option ${i + 1}`,
  }))
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('cardToOutbound', () => {
  // ── WhatsApp: 0 buttons ──────────────────────────────────────────────────

  it('WhatsApp + 0 buttons → text only with title and bodies joined', () => {
    const card = makeCard({
      title: 'Hello',
      children: [
        { type: 'text', content: 'First paragraph.' },
        { type: 'text', content: 'Second paragraph.' },
      ],
    })
    const msg = cardToOutbound(card, '+1234', 'whatsapp')
    expect(msg.metadata).toBeUndefined()
    expect(msg.text).toContain('Hello')
    expect(msg.text).toContain('First paragraph.')
    expect(msg.text).toContain('Second paragraph.')
  })

  // ── WhatsApp: 1 button ───────────────────────────────────────────────────

  it('WhatsApp + 1 button → interactive type=button, body has text, action has 1 reply', () => {
    const card = makeCard({
      title: 'Pick one',
      children: [
        { type: 'text', content: 'Here is your choice.' },
        { type: 'actions', children: [{ type: 'button', id: 'opt_a', label: 'Option A' }] },
      ],
    })
    const msg = cardToOutbound(card, '+1234', 'whatsapp')
    expect(msg.text).toBeUndefined()
    const interactive = msg.metadata?.interactive as Record<string, unknown>
    expect(interactive.type).toBe('button')
    const action = interactive.action as { buttons: Array<{ reply: { id: string; title: string } }> }
    expect(action.buttons).toHaveLength(1)
    expect(action.buttons[0].reply.id).toBe('opt_a')
    expect(action.buttons[0].reply.title).toBe('Option A')
    const body = interactive.body as { text: string }
    expect(body.text).toContain('Here is your choice.')
  })

  // ── WhatsApp: 3 buttons ──────────────────────────────────────────────────

  it('WhatsApp + 3 buttons → interactive type=button, action.buttons has 3 replies', () => {
    const card = makeCard({
      title: 'Choose',
      children: [
        { type: 'text', content: 'Body text.' },
        { type: 'actions', children: makeButtons(3) },
      ],
    })
    const msg = cardToOutbound(card, '+1234', 'whatsapp')
    const interactive = msg.metadata?.interactive as Record<string, unknown>
    expect(interactive.type).toBe('button')
    const action = interactive.action as { buttons: unknown[] }
    expect(action.buttons).toHaveLength(3)
  })

  // ── WhatsApp: 4 buttons ──────────────────────────────────────────────────

  it('WhatsApp + 4 buttons → interactive type=list, action.sections[0].rows has 4 rows', () => {
    const card = makeCard({
      title: 'More options',
      children: [
        { type: 'text', content: 'Body text.' },
        { type: 'actions', children: makeButtons(4) },
      ],
    })
    const msg = cardToOutbound(card, '+1234', 'whatsapp')
    const interactive = msg.metadata?.interactive as Record<string, unknown>
    expect(interactive.type).toBe('list')
    const action = interactive.action as { sections: Array<{ rows: unknown[] }> }
    expect(action.sections[0].rows).toHaveLength(4)
  })

  // ── WhatsApp: 11 buttons → truncated to WA_LIST_ROW_MAX ──────────────────

  it(`WhatsApp + 11 buttons → list with ${WA_LIST_ROW_MAX} rows (truncated)`, () => {
    const card = makeCard({
      title: 'Long list',
      children: [
        { type: 'text', content: 'Body.' },
        { type: 'actions', children: makeButtons(11) },
      ],
    })
    const msg = cardToOutbound(card, '+1234', 'whatsapp')
    const interactive = msg.metadata?.interactive as Record<string, unknown>
    expect(interactive.type).toBe('list')
    const action = interactive.action as { sections: Array<{ rows: unknown[] }> }
    expect(action.sections[0].rows).toHaveLength(WA_LIST_ROW_MAX)
  })

  // ── Button label truncation ───────────────────────────────────────────────

  it(`WhatsApp + button label of 25 chars → row title truncated to ${WA_ROW_TITLE_MAX - 1} chars + …`, () => {
    const longLabel = 'X'.repeat(25)
    const card = makeCard({
      title: 'Truncation test',
      children: [
        { type: 'text', content: 'Body.' },
        {
          type: 'actions',
          children: [
            { type: 'button', id: 'b1', label: longLabel },
            { type: 'button', id: 'b2', label: longLabel },
            { type: 'button', id: 'b3', label: longLabel },
            { type: 'button', id: 'b4', label: longLabel },
          ],
        },
      ],
    })
    const msg = cardToOutbound(card, '+1234', 'whatsapp')
    const interactive = msg.metadata?.interactive as Record<string, unknown>
    expect(interactive.type).toBe('list')
    const action = interactive.action as { sections: Array<{ rows: Array<{ title: string }> }> }
    const rowTitle = action.sections[0].rows[0].title
    expect(rowTitle.length).toBe(WA_ROW_TITLE_MAX)
    expect(rowTitle.endsWith('…')).toBe(true)
  })

  it(`WhatsApp + button label of 25 chars on type=button → reply title truncated to ${WA_BUTTON_TITLE_MAX - 1} chars + …`, () => {
    const longLabel = 'X'.repeat(25)
    const card = makeCard({
      title: 'Truncation test',
      children: [
        { type: 'text', content: 'Body.' },
        { type: 'actions', children: [{ type: 'button', id: 'b1', label: longLabel }] },
      ],
    })
    const msg = cardToOutbound(card, '+1234', 'whatsapp')
    const interactive = msg.metadata?.interactive as Record<string, unknown>
    expect(interactive.type).toBe('button')
    const action = interactive.action as { buttons: Array<{ reply: { title: string } }> }
    const title = action.buttons[0].reply.title
    expect(title.length).toBe(WA_BUTTON_TITLE_MAX)
    expect(title.endsWith('…')).toBe(true)
  })

  // ── Header truncation ────────────────────────────────────────────────────

  it(`WhatsApp + title of 80 chars → header.text truncated to ${WA_HEADER_MAX - 1} chars + …`, () => {
    const longTitle = 'A'.repeat(80)
    const card = makeCard({
      title: longTitle,
      children: [
        { type: 'text', content: 'Body.' },
        { type: 'actions', children: [{ type: 'button', id: 'b1', label: 'Go' }] },
      ],
    })
    const msg = cardToOutbound(card, '+1234', 'whatsapp')
    const interactive = msg.metadata?.interactive as Record<string, unknown>
    const header = interactive.header as { text: string }
    expect(header.text.length).toBe(WA_HEADER_MAX)
    expect(header.text.endsWith('…')).toBe(true)
  })

  // ── Non-WhatsApp fallback ─────────────────────────────────────────────────

  it('web channel + 4 buttons → text fallback contains [Button] labels', () => {
    const card = makeCard({
      title: 'Web fallback',
      children: [
        { type: 'text', content: 'Some body.' },
        {
          type: 'actions',
          children: [
            { type: 'button', id: 'b1', label: 'Button1' },
            { type: 'button', id: 'b2', label: 'Button2' },
            { type: 'button', id: 'b3', label: 'Button3' },
            { type: 'button', id: 'b4', label: 'Button4' },
          ],
        },
      ],
    })
    const msg = cardToOutbound(card, 'contact-web-1', 'web')
    expect(msg.metadata).toBeUndefined()
    expect(msg.text).toContain('[Button1]')
    expect(msg.text).toContain('[Button2]')
    expect(msg.text).toContain('[Button3]')
    expect(msg.text).toContain('[Button4]')
  })

  // ── fields element gets rendered into body (regression test for q7dwqo7c) ──

  it('WhatsApp + fields child → body renders each field as "*label*: value"', () => {
    const card: CardElement = {
      type: 'card',
      title: 'Plans & pricing',
      children: [
        {
          type: 'fields',
          children: [
            { type: 'field', label: 'Free', value: '1 user, 100 tasks/month' },
            { type: 'field', label: 'Pro', value: '$12/user/month, unlimited tasks, integrations, priority support' },
            { type: 'field', label: 'Teams', value: '$24/user/month, SSO, audit log, team workspaces, admin console' },
          ],
        },
        { type: 'text', content: 'Enterprise is custom-priced for larger or security-sensitive teams.' },
        {
          type: 'actions',
          children: [
            { id: 'compare_plans', type: 'button', label: 'Help me choose', style: 'primary' },
            { id: 'enterprise_info', type: 'button', label: 'Enterprise options' },
            { id: 'billing_question', type: 'button', label: 'Billing question' },
          ],
        },
      ],
    }
    const msg = cardToOutbound(card, '+1234', 'whatsapp')
    const interactive = msg.metadata?.interactive as Record<string, unknown>
    expect(interactive.type).toBe('button')
    const body = interactive.body as { text: string }
    // Field labels rendered with WhatsApp bold markdown.
    expect(body.text).toContain('*Free*: 1 user, 100 tasks/month')
    expect(body.text).toContain('*Pro*: $12/user/month')
    expect(body.text).toContain('*Teams*: $24/user/month')
    // Trailing text stays in body — no footer auto-promotion.
    expect(body.text).toContain('Enterprise is custom-priced')
    expect(interactive.footer).toBeUndefined()
  })

  it('WhatsApp + link-button in actions → renders as labelled URL in body, not as a reply button', () => {
    const card: CardElement = {
      type: 'card',
      title: 'Docs',
      children: [
        { type: 'text', content: 'See our integration guide.' },
        {
          type: 'actions',
          children: [
            { type: 'link-button', label: 'Open docs', url: 'https://example.com/docs' },
            { type: 'button', id: 'ack', label: 'Got it' },
          ],
        },
      ],
    }
    const msg = cardToOutbound(card, '+1234', 'whatsapp')
    const interactive = msg.metadata?.interactive as Record<string, unknown>
    expect(interactive.type).toBe('button')
    const body = interactive.body as { text: string }
    expect(body.text).toContain('Open docs: https://example.com/docs')
    const action = interactive.action as { buttons: Array<{ reply: { id: string } }> }
    expect(action.buttons).toHaveLength(1)
    expect(action.buttons[0].reply.id).toBe('ack')
  })

  it('WhatsApp + only buttons (no title, no text) → body falls back to single space (WA rejects empty)', () => {
    const card: CardElement = {
      type: 'card',
      children: [{ type: 'actions', children: [{ type: 'button', id: 'go', label: 'Go' }] }],
    }
    const msg = cardToOutbound(card, '+1234', 'whatsapp')
    const interactive = msg.metadata?.interactive as Record<string, unknown>
    const body = interactive.body as { text: string }
    expect(body.text.length).toBeGreaterThan(0)
  })

  // ── Real-world fixture from conv u0uzf9ut ─────────────────────────────────

  it('real-world fixture from conv u0uzf9ut → list interactive with 4 rows, correct header and body', () => {
    const card: CardElement = {
      type: 'card',
      title: 'How I can help',
      children: [
        {
          type: 'text',
          content:
            'I can help with plans and pricing, billing and refunds, integrations, data export, account changes, and general product questions.',
        },
        {
          type: 'actions',
          children: [
            { id: 'plans_pricing', type: 'button', label: 'Plans & pricing', style: 'primary' },
            { id: 'billing_refunds', type: 'button', label: 'Billing & refunds' },
            { id: 'integrations', type: 'button', label: 'Integrations' },
            { id: 'account_help', type: 'button', label: 'Account help' },
          ],
        },
        {
          type: 'text',
          content: 'Or tell me what you need in your own words.',
        },
      ],
    }

    const msg = cardToOutbound(card, '+6512345678', 'whatsapp')

    expect(msg.text).toBeUndefined()
    const interactive = msg.metadata?.interactive as Record<string, unknown>

    // 4 buttons → list
    expect(interactive.type).toBe('list')

    // Header carries the title
    const header = interactive.header as { text: string }
    expect(header.text).toBe('How I can help')

    // Body has both text children — no footer auto-promotion.
    const body = interactive.body as { text: string }
    expect(body.text).toContain('I can help with plans and pricing')
    expect(body.text).toContain('Or tell me what you need in your own words.')
    expect(interactive.footer).toBeUndefined()

    // All 4 rows present with correct ids
    const action = interactive.action as { sections: Array<{ rows: Array<{ id: string; title: string }> }> }
    const rows = action.sections[0].rows
    expect(rows).toHaveLength(4)
    expect(rows[0].id).toBe('plans_pricing')
    expect(rows[1].id).toBe('billing_refunds')
    expect(rows[2].id).toBe('integrations')
    expect(rows[3].id).toBe('account_help')
  })
})
