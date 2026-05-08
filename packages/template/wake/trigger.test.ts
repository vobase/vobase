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

  it('points at INTERNAL-NOTES and references the AGENTS.md routing table', () => {
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
  })

  it('keeps the existing peer-wake guard for non-assignee agents', () => {
    const text = cap.render(
      {
        trigger: 'staff_note',
        conversationId: 'cnv0marcus',
        noteId: 'note0001',
        authorUserId: 'usr0alice',
        mentionedAgentId: 'agt0atls0v1',
      },
      {
        contactId: 'ct0marcus',
        channelInstanceId: 'ch0web',
        assignee: 'agent:agt0mer0v1',
        currentAgentId: 'agt0atls0v1',
      },
    )
    expect(text).toContain('You are NOT the conversation assignee')
    expect(text).toContain('Do NOT call reply / send_card / send_file / book_slot')
  })
})
