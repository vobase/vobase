import { describe, expect, it } from 'bun:test'

import { renderUnreadActivity, type UnreadActivitySnapshot } from './unread-activity'

const FOLDER = '/contacts/c1/ch1'

function emptySnapshot(): UnreadActivitySnapshot {
  return {
    since: null,
    messages: [],
    hasMoreMessages: false,
    notes: [],
    hasMoreNotes: false,
    sinceCustomer: null,
    selfActivity: [],
    hasMoreSelf: false,
  }
}

describe('renderUnreadActivity', () => {
  it('returns empty string when nothing is unread', () => {
    expect(renderUnreadActivity(emptySnapshot(), FOLDER)).toBe('')
  })

  it('lists customer messages in order with timestamps', () => {
    const snap: UnreadActivitySnapshot = {
      since: new Date('2026-05-12T09:00:00Z'),
      messages: [
        { role: 'customer', ts: new Date('2026-05-12T10:14:00Z'), body: 'Best under budget' },
        { role: 'customer', ts: new Date('2026-05-12T10:15:00Z'), body: 'Couples Retreat' },
      ],
      hasMoreMessages: false,
      notes: [],
      hasMoreNotes: false,
      sinceCustomer: null,
      selfActivity: [],
      hasMoreSelf: false,
    }
    const out = renderUnreadActivity(snap, FOLDER)
    expect(out).toContain('## Other recent activity (context)')
    expect(out).toContain('Messages (2 customer)')
    expect(out).toContain('[2026-05-12 10:14 | customer]')
    expect(out).toContain('> Best under budget')
    expect(out).toContain('[2026-05-12 10:15 | customer]')
    expect(out).toContain('> Couples Retreat')
    expect(out.indexOf('Best under budget')).toBeLessThan(out.indexOf('Couples Retreat'))
  })

  it('summarises overflow with a file pointer when hasMoreMessages is true', () => {
    const snap: UnreadActivitySnapshot = {
      since: null,
      messages: [{ role: 'customer', ts: new Date('2026-05-12T10:14:00Z'), body: 'hi' }],
      hasMoreMessages: true,
      notes: [],
      hasMoreNotes: false,
      sinceCustomer: null,
      selfActivity: [],
      hasMoreSelf: false,
    }
    const out = renderUnreadActivity(snap, FOLDER)
    expect(out).toContain(`more older messages exist beyond the 50-row cap — read ${FOLDER}/MESSAGES.md`)
  })

  it('renders staff messages and notes alongside customer messages', () => {
    const snap: UnreadActivitySnapshot = {
      since: new Date('2026-05-12T09:00:00Z'),
      messages: [
        { role: 'customer', ts: new Date('2026-05-12T10:14:00Z'), body: 'Help' },
        { role: 'staff', ts: new Date('2026-05-12T10:16:00Z'), body: '[Yash] hi' },
      ],
      hasMoreMessages: false,
      notes: [{ ts: new Date('2026-05-12T10:15:00Z'), authorLabel: 'staff:u1', body: 'try msg again' }],
      hasMoreNotes: false,
      sinceCustomer: null,
      selfActivity: [],
      hasMoreSelf: false,
    }
    const out = renderUnreadActivity(snap, FOLDER)
    expect(out).toContain('Messages (1 customer, 1 staff)')
    expect(out).toContain('Internal notes (1 new from non-self)')
    expect(out).toContain('[2026-05-12 10:15 | staff:u1]')
    expect(out).toContain('> try msg again')
    expect(out).toContain('The trigger at the top of this turn is what brought this wake')
  })

  it('renders the self-anchor block when the agent has recent outbound', () => {
    const snap: UnreadActivitySnapshot = {
      since: new Date('2026-05-12T10:16:00Z'),
      messages: [],
      hasMoreMessages: false,
      notes: [],
      hasMoreNotes: false,
      sinceCustomer: new Date('2026-05-12T10:10:00Z'),
      selfActivity: [
        { kind: 'card', ts: new Date('2026-05-12T10:14:00Z'), body: '[card: Premium 42 promo for your slot]' },
        { kind: 'note', ts: new Date('2026-05-12T10:15:00Z'), body: 'Added high-priority label as requested.' },
      ],
      hasMoreSelf: false,
    }
    const out = renderUnreadActivity(snap, FOLDER)
    expect(out).toContain('Your recent actions (since last customer/staff inbound — already done, do not re-send)')
    expect(out).toContain('[2026-05-12 10:14 | card]')
    expect(out).toContain('> [card: Premium 42 promo for your slot]')
    expect(out).toContain('[2026-05-12 10:15 | note]')
    expect(out).toContain('> Added high-priority label as requested.')
    expect(out).toContain('do not re-fire the same card or reply')
  })
})
