import { describe, expect, it } from 'bun:test'

import { resolveTriggerSpec } from './trigger'

describe('resolveTriggerSpec', () => {
  it('routes inbound_message to the conversation lane', () => {
    const cap = resolveTriggerSpec('inbound_message')
    expect(cap.lane).toBe('conversation')
    expect(cap.logPrefix).toBe('wake:conv')
  })

  it('routes staff_note to the conversation lane', () => {
    const cap = resolveTriggerSpec('staff_note')
    expect(cap.lane).toBe('conversation')
    expect(cap.logPrefix).toBe('wake:conv')
  })

  it('routes approval_resumed to the conversation lane', () => {
    const cap = resolveTriggerSpec('approval_resumed')
    expect(cap.lane).toBe('conversation')
    expect(cap.logPrefix).toBe('wake:conv')
  })

  it('routes scheduled_followup to the conversation lane', () => {
    const cap = resolveTriggerSpec('scheduled_followup')
    expect(cap.lane).toBe('conversation')
    expect(cap.logPrefix).toBe('wake:conv')
  })

  it('routes manual to the conversation lane', () => {
    const cap = resolveTriggerSpec('manual')
    expect(cap.lane).toBe('conversation')
    expect(cap.logPrefix).toBe('wake:conv')
  })

  it('routes operator_thread to the standalone lane', () => {
    const cap = resolveTriggerSpec('operator_thread')
    expect(cap.lane).toBe('standalone')
    expect(cap.logPrefix).toBe('wake:solo')
  })

  it('routes heartbeat to the standalone lane', () => {
    const cap = resolveTriggerSpec('heartbeat')
    expect(cap.lane).toBe('standalone')
    expect(cap.logPrefix).toBe('wake:solo')
  })

  it('routes change_decided to the conversation lane', () => {
    const cap = resolveTriggerSpec('change_decided')
    expect(cap.lane).toBe('conversation')
    expect(cap.logPrefix).toBe('wake:conv')
  })
})

describe('renderChangeDecided', () => {
  const cap = resolveTriggerSpec('change_decided')

  it('on approval, instructs a brief confirmation reply and forbids re-attempts', () => {
    const text = cap.render(
      {
        trigger: 'change_decided',
        conversationId: 'cv1',
        proposalId: 'prp1',
        decision: 'approved',
        resourceModule: 'contacts',
        resourceType: 'contact',
        resourceId: 'c1',
        summary: '5 details about Marc Chen',
        decidedNote: 'Confirmed via the customer chat — looks legit.',
        decidedBy: 'usr0alice',
      },
      {
        contactId: 'c1',
        channelInstanceId: 'ch0web',
        assignee: 'agent:agt0meri',
        currentAgentId: 'agt0meri',
      },
    )
    expect(text).toContain('APPROVED 5 details about Marc Chen')
    expect(text).toContain('a confirmation message is required')
    expect(text).toContain('Do NOT')
    expect(text).toContain('re-attempt')
  })

  it('on rejection with a staff note, surfaces the note and asks for a polite acknowledgment', () => {
    const text = cap.render(
      {
        trigger: 'change_decided',
        conversationId: 'cv1',
        proposalId: 'prp2',
        decision: 'rejected',
        resourceModule: 'contacts',
        resourceType: 'contact',
        resourceId: 'c1',
        summary: 'an email change',
        decidedNote: 'Email change needs to come from the corporate IT mailbox.',
        decidedBy: 'usr0alice',
      },
      {
        contactId: 'c1',
        channelInstanceId: 'ch0web',
        assignee: 'agent:agt0meri',
        currentAgentId: 'agt0meri',
      },
    )
    expect(text).toContain('DECLINED an email change')
    expect(text).toContain('Email change needs to come from the corporate IT mailbox.')
    expect(text).toContain('do NOT quote it to the customer')
    expect(text).toContain('Acknowledge politely')
    expect(text).toContain('Do NOT re-attempt')
  })

  it('on rejection without a staff note, falls back to a generic message', () => {
    const text = cap.render(
      {
        trigger: 'change_decided',
        conversationId: 'cv1',
        proposalId: 'prp3',
        decision: 'rejected',
        resourceModule: 'contacts',
        resourceType: 'contact',
        resourceId: 'c1',
        summary: 'a profile change',
        decidedNote: null,
        decidedBy: 'usr0alice',
      },
      {
        contactId: 'c1',
        channelInstanceId: 'ch0web',
        assignee: 'agent:agt0meri',
        currentAgentId: 'agt0meri',
      },
    )
    expect(text).toContain('DECLINED a profile change')
    expect(text).toContain('No staff note was attached.')
  })

  it('uses a fallback summary when the proposal had no rationale', () => {
    const text = cap.render(
      {
        trigger: 'change_decided',
        conversationId: 'cv1',
        proposalId: 'prp4',
        decision: 'approved',
        resourceModule: 'contacts',
        resourceType: 'contact',
        resourceId: 'c1',
        summary: null,
        decidedNote: null,
        decidedBy: 'usr0alice',
      },
      {
        contactId: 'c1',
        channelInstanceId: 'ch0web',
        assignee: 'agent:agt0meri',
        currentAgentId: 'agt0meri',
      },
    )
    expect(text).toContain('APPROVED a change you proposed')
  })
})

describe('renderStaffNote (assignee branch)', () => {
  const cap = resolveTriggerSpec('staff_note')

  it('points at INTERNAL-NOTES and references the AGENTS.md routing table when body is absent', () => {
    const text = cap.render(
      {
        trigger: 'staff_note',
        conversationId: 'cnv0marcus',
        noteId: 'note0001',
        authorUserId: 'usr0alice',
        mentionedAgentId: 'agt0mer0v1',
      },
      {
        contactId: 'ct0marcus',
        channelInstanceId: 'ch0web',
        assignee: 'agent:agt0mer0v1',
        currentAgentId: 'agt0mer0v1',
      },
    )
    expect(text).toContain('INTERNAL-NOTES.md')
    expect(text).toMatch(/routing table|AGENTS\.md/)
    // No body provided → no blockquote.
    expect(text).not.toContain('> ')
  })

  it('inlines the note body as a blockquote when provided', () => {
    const text = cap.render(
      {
        trigger: 'staff_note',
        conversationId: 'cnv0marcus',
        noteId: 'note0001',
        authorUserId: 'usr0alice',
        mentionedAgentId: 'agt0mer0v1',
        body: '@MeriGPT yes we are GST registered, UEN 202012345A',
      },
      {
        contactId: 'ct0marcus',
        channelInstanceId: 'ch0web',
        assignee: 'agent:agt0mer0v1',
        currentAgentId: 'agt0mer0v1',
      },
    )
    expect(text).toContain('staff:usr0alice')
    expect(text).toContain('> @MeriGPT yes we are GST registered, UEN 202012345A')
    expect(text).toContain('INTERNAL-NOTES.md')
    expect(text).toMatch(/routing table|AGENTS\.md/)
  })

  it('keeps the existing peer-wake guard for non-assignee agents', () => {
    const text = cap.render(
      {
        trigger: 'staff_note',
        conversationId: 'cnv0marcus',
        noteId: 'note0001',
        authorUserId: 'usr0alice',
        mentionedAgentId: 'agt0atls0v1',
        body: '@Atlas please confirm the SLA for tier-2 incidents',
      },
      {
        contactId: 'ct0marcus',
        channelInstanceId: 'ch0web',
        assignee: 'agent:agt0mer0v1',
        currentAgentId: 'agt0atls0v1',
      },
    )
    expect(text).toContain('You are NOT the conversation assignee')
    expect(text).toContain('reply_contact / send_card / send_file')
    // Body is still inlined in the peer-wake branch.
    expect(text).toContain('> @Atlas please confirm the SLA for tier-2 incidents')
  })
})

describe('renderInboundMessage', () => {
  const cap = resolveTriggerSpec('inbound_message')
  const refs = {
    contactId: 'ct0marcus',
    channelInstanceId: 'ch0web',
    assignee: 'agent:agt0mer0v1',
    currentAgentId: 'agt0mer0v1',
  }

  it('points at MESSAGES.md when no body is provided', () => {
    const text = cap.render({ trigger: 'inbound_message', conversationId: 'cnv0marcus', messageIds: ['m1'] }, refs)
    expect(text).toContain('New customer message(s)')
    expect(text).toContain('/contacts/ct0marcus/ch0web/MESSAGES.md')
    expect(text).not.toContain('> ')
  })

  it('inlines the latest message body as a blockquote when provided', () => {
    const text = cap.render(
      {
        trigger: 'inbound_message',
        conversationId: 'cnv0marcus',
        messageIds: ['m1'],
        body: 'are you GST registered?',
      },
      refs,
    )
    expect(text).toContain('New customer message:')
    expect(text).toContain('> are you GST registered?')
    expect(text).toContain('MESSAGES.md')
  })
})

describe('renderCaptionReady', () => {
  const cap = resolveTriggerSpec('caption_ready')
  const refs = {
    contactId: 'ct0marcus',
    channelInstanceId: 'ch0web',
    assignee: 'agent:agt0mer0v1',
    currentAgentId: 'agt0mer0v1',
  }

  it('falls back to the file id pointer when caption is absent', () => {
    const text = cap.render({ trigger: 'caption_ready', conversationId: 'cnv0marcus', fileId: 'fil0001' }, refs)
    expect(text).toContain('Caption ready for file fil0001.')
    expect(text).toContain('Re-read /contacts/ct0marcus/ch0web/MESSAGES.md')
    expect(text).not.toContain('> ')
  })

  it('quotes the caption and uses the file path label when both are provided', () => {
    const text = cap.render(
      {
        trigger: 'caption_ready',
        conversationId: 'cnv0marcus',
        fileId: 'fil0001',
        filePath: '/policies/refunds.pdf',
        caption: 'Refund policy: 14-day window from purchase date, prorated thereafter.',
      },
      refs,
    )
    expect(text).toContain('Caption ready for /policies/refunds.pdf:')
    expect(text).toContain('> Refund policy: 14-day window from purchase date, prorated thereafter.')
    expect(text).toContain('Re-read /contacts/ct0marcus/ch0web/MESSAGES.md')
  })
})

describe('cue body truncation', () => {
  const cap = resolveTriggerSpec('staff_note')
  const refs = {
    contactId: 'ct0marcus',
    channelInstanceId: 'ch0web',
    assignee: 'agent:agt0mer0v1',
    currentAgentId: 'agt0mer0v1',
  }

  it('caps the inlined body within 4KB (marker reserved) and appends a truncation marker', () => {
    // 6KB of repeated lines so the cap (4KB) trips on a line boundary.
    const line = `${'x'.repeat(120)}\n`
    const longBody = line.repeat(50) // ~6KB
    const text = cap.render(
      {
        trigger: 'staff_note',
        conversationId: 'cnv0marcus',
        noteId: 'note0001',
        authorUserId: 'usr0alice',
        mentionedAgentId: 'agt0mer0v1',
        body: longBody,
      },
      refs,
    )
    expect(text).toContain('[truncated')
    expect(text).toContain('INTERNAL-NOTES.md')
    // The quoted body section (truncateForCue output + `> ` per line by quoteBody) is bounded by 4KB
    // plus ~2 bytes per line of blockquote prefix. Extract from the first quoted line to the trailing pointer.
    const quoteStart = text.indexOf('\n\n> ') + 2
    const quoteEnd = text.indexOf('\n\nFull thread in ')
    const quotedSection = text.slice(quoteStart, quoteEnd)
    expect(Buffer.byteLength(quotedSection, 'utf8')).toBeLessThanOrEqual(4096 + 200)
  })

  it('returns the pre-fix cue byte-for-byte when body is absent (back-compat guard)', () => {
    // Locked text — any change here is a back-compat break that downstream hash/snapshot
    // logic or test fixtures might silently fail against.
    const text = cap.render(
      {
        trigger: 'staff_note',
        conversationId: 'cnv0marcus',
        noteId: 'note0001',
        authorUserId: 'usr0alice',
        mentionedAgentId: 'agt0mer0v1',
      },
      refs,
    )
    expect(text).toBe(
      'Staff @-mentioned you in an internal note. Read /contacts/ct0marcus/ch0web/INTERNAL-NOTES.md for context. Decide what the note asks for and act — see `## Staff note (this wake)` in AGENTS.md for the routing table.',
    )
  })

  it('does not truncate when body fits under the cap', () => {
    const text = cap.render(
      {
        trigger: 'staff_note',
        conversationId: 'cnv0marcus',
        noteId: 'note0001',
        authorUserId: 'usr0alice',
        mentionedAgentId: 'agt0mer0v1',
        body: 'short note',
      },
      refs,
    )
    expect(text).not.toContain('[truncated')
    expect(text).toContain('> short note')
  })
})
