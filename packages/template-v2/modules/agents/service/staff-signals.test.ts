/**
 * detectStaffSignals — pure-function scan over a wake's event stream.
 * Covers the four staff-signal shapes.
 */

import { describe, expect, it } from 'bun:test'
import type { AgentEvent } from '~/wake/events'

import { detectStaffSignals } from './staff-signals'

function baseFields() {
  return {
    ts: new Date('2026-04-19T10:00:00Z'),
    wakeId: 'wake-1',
    conversationId: 'conv-1',
    organizationId: 'org-1',
    turnIndex: 0,
  }
}

describe('detectStaffSignals', () => {
  it('returns [] for a wake with no qualifying signals', () => {
    const events: AgentEvent[] = [
      {
        type: 'agent_start',
        ...baseFields(),
        agentId: 'agt-1',
        trigger: 'inbound_message',
        triggerPayload: { trigger: 'inbound_message', conversationId: 'conv-1', messageIds: ['m1'] },
        systemHash: 'hash',
      },
      { type: 'agent_end', ...baseFields(), reason: 'complete' },
    ]
    expect(detectStaffSignals(events)).toEqual([])
  })

  it('detects supervisor trigger with staff note id', () => {
    const events: AgentEvent[] = [
      {
        type: 'agent_start',
        ...baseFields(),
        agentId: 'agt-1',
        trigger: 'supervisor',
        triggerPayload: {
          trigger: 'supervisor',
          conversationId: 'conv-1',
          noteId: 'note-99',
          authorUserId: 'user-staff-1',
        },
        systemHash: 'hash',
      },
    ]
    const signals = detectStaffSignals(events)
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      kind: 'supervisor',
      ref: 'note-99',
      actorUserId: 'user-staff-1',
      scopeHint: 'contact',
    })
  })

  it('ignores supervisor-shaped event that is not agent_start', () => {
    const events: AgentEvent[] = [
      { type: 'turn_start', ...baseFields() },
      { type: 'turn_end', ...baseFields(), tokensIn: 0, tokensOut: 0, costUsd: 0 },
    ]
    expect(detectStaffSignals(events)).toEqual([])
  })

  it('detects approval_resumed + rejected', () => {
    const events: AgentEvent[] = [
      {
        type: 'agent_start',
        ...baseFields(),
        agentId: 'agt-1',
        trigger: 'approval_resumed',
        triggerPayload: {
          trigger: 'approval_resumed',
          conversationId: 'conv-1',
          approvalId: 'appr-42',
          decision: 'rejected',
          note: 'price is wrong',
        },
        systemHash: 'hash',
      },
    ]
    const signals = detectStaffSignals(events)
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      kind: 'approval_rejected',
      ref: 'appr-42',
      notePreview: 'price is wrong',
      scopeHint: 'agent_skill',
    })
  })

  it('ignores approval_resumed + approved', () => {
    const events: AgentEvent[] = [
      {
        type: 'agent_start',
        ...baseFields(),
        agentId: 'agt-1',
        trigger: 'approval_resumed',
        triggerPayload: {
          trigger: 'approval_resumed',
          conversationId: 'conv-1',
          approvalId: 'appr-43',
          decision: 'approved',
        },
        systemHash: 'hash',
      },
    ]
    expect(detectStaffSignals(events)).toEqual([])
  })

  it('detects internal_note_added with staff author', () => {
    const events: AgentEvent[] = [
      {
        type: 'internal_note_added',
        ...baseFields(),
        noteId: 'note-77',
        authorType: 'staff',
      },
    ]
    const signals = detectStaffSignals(events)
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      kind: 'internal_note',
      ref: 'note-77',
      scopeHint: 'agent_memory',
    })
  })

  it('ignores internal_note_added from agent author', () => {
    const events: AgentEvent[] = [
      {
        type: 'internal_note_added',
        ...baseFields(),
        noteId: 'note-78',
        authorType: 'agent',
      },
    ]
    expect(detectStaffSignals(events)).toEqual([])
  })

  it('detects manual reassignment note', () => {
    const events: AgentEvent[] = [
      {
        type: 'agent_start',
        ...baseFields(),
        agentId: 'agt-1',
        trigger: 'manual',
        triggerPayload: {
          trigger: 'manual',
          conversationId: 'conv-1',
          reason: 'Reassigned to billing team — customer has enterprise contract',
          actorUserId: 'user-staff-2',
        },
        systemHash: 'hash',
      },
    ]
    const signals = detectStaffSignals(events)
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      kind: 'reassignment_note',
      ref: 'user-staff-2',
      actorUserId: 'user-staff-2',
      scopeHint: 'contact',
    })
  })

  it('ignores manual trigger whose reason does not start with "reassign"', () => {
    const events: AgentEvent[] = [
      {
        type: 'agent_start',
        ...baseFields(),
        agentId: 'agt-1',
        trigger: 'manual',
        triggerPayload: {
          trigger: 'manual',
          conversationId: 'conv-1',
          reason: 'Manual wake from staff dashboard',
          actorUserId: 'user-staff-3',
        },
        systemHash: 'hash',
      },
    ]
    expect(detectStaffSignals(events)).toEqual([])
  })

  it('collects multiple signals across a single wake', () => {
    const events: AgentEvent[] = [
      {
        type: 'agent_start',
        ...baseFields(),
        agentId: 'agt-1',
        trigger: 'supervisor',
        triggerPayload: {
          trigger: 'supervisor',
          conversationId: 'conv-1',
          noteId: 'note-101',
          authorUserId: 'user-staff-1',
        },
        systemHash: 'hash',
      },
      {
        type: 'internal_note_added',
        ...baseFields(),
        noteId: 'note-102',
        authorType: 'staff',
      },
    ]
    const signals = detectStaffSignals(events)
    expect(signals.map((s) => s.kind)).toEqual(['supervisor', 'internal_note'])
  })
})
