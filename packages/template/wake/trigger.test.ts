import { describe, expect, it } from 'bun:test'

import { resolveTriggerSpec } from './trigger'

describe('resolveTriggerSpec', () => {
  it('routes inbound_message to the conversation lane', () => {
    const cap = resolveTriggerSpec('inbound_message')
    expect(cap.lane).toBe('conversation')
    expect(cap.logPrefix).toBe('wake:conv')
  })

  it('routes supervisor to the conversation lane', () => {
    const cap = resolveTriggerSpec('supervisor')
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

describe('renderSupervisor (assignee branch)', () => {
  const cap = resolveTriggerSpec('supervisor')

  it('tells the agent staff notes are coaching, not a reply signal', () => {
    const text = cap.render(
      {
        trigger: 'supervisor',
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
    expect(text).toContain('NOT a request to send another customer reply')
    expect(text).toMatch(/MEMORY\.md/)
    expect(text).toMatch(/`add_note`.*`mentions`/)
    // Read directive must appear before the lesson-capture directive
    const catIdx = text.indexOf('cat /contacts/')
    const memoryIdx = text.indexOf('MEMORY.md')
    expect(catIdx).toBeGreaterThan(-1)
    expect(catIdx).toBeLessThan(memoryIdx)
    // Must not contain the old meta-pointer that gave the model an excuse to defer
    expect(text).not.toContain('Follow your supervisor-coaching playbook from your instructions')
  })

  it('keeps the existing peer-wake guard for non-assignee agents', () => {
    const text = cap.render(
      {
        trigger: 'supervisor',
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

  it('keeps the peer-wake guard even when supervisorKind is ask_staff_answer (peer wake never asked)', () => {
    const text = cap.render(
      {
        trigger: 'supervisor',
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
        supervisorKind: 'ask_staff_answer',
      },
    )
    expect(text).toContain('You are NOT the conversation assignee')
    expect(text).toContain('Do NOT call reply / send_card / send_file / book_slot')
  })

  it('switches to ask-staff-answered branch when assignee + supervisorKind=ask_staff_answer', () => {
    const text = cap.render(
      {
        trigger: 'supervisor',
        conversationId: 'cnv0marcus',
        noteId: 'note0002',
        authorUserId: 'usr0alice',
        mentionedAgentId: 'agt0mer0v1',
      },
      {
        contactId: 'ct0marcus',
        channelInstanceId: 'ch0web',
        assignee: 'agent:agt0mer0v1',
        currentAgentId: 'agt0mer0v1',
        supervisorKind: 'ask_staff_answer',
      },
    )
    expect(text).toContain('send the customer-facing reply now')
    expect(text).not.toContain('NOT a request to send another customer reply')
    // Read directive must appear before the customer-facing action directive
    const catIdx = text.indexOf('cat /contacts/')
    const replyIdx = text.indexOf('send the customer-facing reply now')
    expect(catIdx).toBeGreaterThan(-1)
    expect(catIdx).toBeLessThan(replyIdx)
  })

  it('falls back to coaching branch when assignee has no supervisorKind set', () => {
    const text = cap.render(
      {
        trigger: 'supervisor',
        conversationId: 'cnv0marcus',
        noteId: 'note0003',
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
    expect(text).toContain('NOT a request to send another customer reply')
  })
})
