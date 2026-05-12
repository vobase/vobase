import { describe, expect, it } from 'bun:test'

import { renderUnreadActivity, type UnreadActivitySnapshot } from './unread-activity'

const FOLDER = '/contacts/c1/ch1'

function emptySnapshot(): UnreadActivitySnapshot {
  return { since: null, messages: [], truncatedMessageCount: 0, notes: [], truncatedNoteCount: 0 }
}

describe('renderUnreadActivity', () => {
  it('returns empty string when nothing is unread', () => {
    expect(renderUnreadActivity(emptySnapshot(), FOLDER)).toBe('')
  })

  it('lists customer messages in order with timestamps', () => {
    const snap: UnreadActivitySnapshot = {
      since: new Date('2026-05-12T09:00:00Z'),
      messages: [
        { kind: 'customer_message', role: 'customer', ts: new Date('2026-05-12T10:14:00Z'), body: 'Best under budget', truncated: false },
        { kind: 'customer_message', role: 'customer', ts: new Date('2026-05-12T10:15:00Z'), body: 'Couples Retreat', truncated: false },
      ],
      truncatedMessageCount: 0,
      notes: [],
      truncatedNoteCount: 0,
    }
    const out = renderUnreadActivity(snap, FOLDER)
    expect(out).toContain('## Activity since your last reply')
    expect(out).toContain('Messages (2 customer)')
    expect(out).toContain('[10:14 | customer]')
    expect(out).toContain('> Best under budget')
    expect(out).toContain('[10:15 | customer]')
    expect(out).toContain('> Couples Retreat')
    // Customer order preserved (oldest first).
    expect(out.indexOf('Best under budget')).toBeLessThan(out.indexOf('Couples Retreat'))
  })

  it('summarises truncated messages with a file pointer', () => {
    const snap: UnreadActivitySnapshot = {
      since: null,
      messages: [
        { kind: 'customer_message', role: 'customer', ts: new Date('2026-05-12T10:14:00Z'), body: 'hi', truncated: false },
      ],
      truncatedMessageCount: 7,
      notes: [],
      truncatedNoteCount: 0,
    }
    const out = renderUnreadActivity(snap, FOLDER)
    expect(out).toContain(`(+7 older message(s) omitted — read ${FOLDER}/MESSAGES.md`)
  })

  it('renders staff messages and notes alongside customer messages', () => {
    const snap: UnreadActivitySnapshot = {
      since: new Date('2026-05-12T09:00:00Z'),
      messages: [
        { kind: 'customer_message', role: 'customer', ts: new Date('2026-05-12T10:14:00Z'), body: 'Help', truncated: false },
        { kind: 'staff_message', role: 'staff', ts: new Date('2026-05-12T10:16:00Z'), body: '[Yash] hi', truncated: false },
      ],
      truncatedMessageCount: 0,
      notes: [
        { ts: new Date('2026-05-12T10:15:00Z'), authorLabel: 'staff:u1', body: 'try msg again', truncated: false },
      ],
      truncatedNoteCount: 0,
    }
    const out = renderUnreadActivity(snap, FOLDER)
    expect(out).toContain('Messages (1 customer, 1 staff echo)')
    expect(out).toContain('Internal notes (1 new from non-self)')
    expect(out).toContain('[10:15 | staff:u1]')
    expect(out).toContain('> try msg again')
    // Authoritative-list directive present.
    expect(out).toContain('authoritative for what is new')
  })
})
