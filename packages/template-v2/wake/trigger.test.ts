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
    expect(text).toContain('coaching/feedback')
    expect(text).toContain('NOT a request to send another customer reply')
    expect(text).toMatch(/MEMORY\.md/)
    expect(text).toContain('vobase conv ask-staff')
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
    expect(text).toContain('Staff is answering the question you posted')
    expect(text).toContain('send the customer-facing reply now')
    expect(text).not.toContain('NOT a request to send another customer reply')
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
