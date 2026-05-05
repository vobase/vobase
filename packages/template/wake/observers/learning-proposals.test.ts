/**
 * createLearningProposalObserver — drives synthetic AgentEvent streams and
 * asserts the observer enqueues the right `insertProposal` calls.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import type { AgentEvent } from '~/wake/events'

const insertCalls: Array<Record<string, unknown>> = []

mock.module('@modules/changes/service/proposals', () => ({
  insertProposal: (input: Record<string, unknown>) => {
    insertCalls.push(input)
    return Promise.resolve({ id: 'p_fake', status: 'auto_written' })
  },
}))

import { createLearningProposalObserver } from './learning-proposals'

interface FakeLogger {
  info: ReturnType<typeof mock>
  warn: ReturnType<typeof mock>
  error: ReturnType<typeof mock>
  debug: ReturnType<typeof mock>
}

function makeLogger(): FakeLogger {
  return {
    info: mock(() => undefined),
    warn: mock(() => undefined),
    error: mock(() => undefined),
    debug: mock(() => undefined),
  }
}

function baseFields() {
  return {
    ts: new Date('2026-04-19T10:00:00Z'),
    wakeId: 'wake-test',
    conversationId: 'conv-1',
    organizationId: 'org-1',
    turnIndex: 0,
  }
}

beforeEach(() => {
  insertCalls.length = 0
})

afterEach(() => {
  insertCalls.length = 0
})

describe('createLearningProposalObserver', () => {
  it('enqueues an agent_memory proposal for a supervisor wake at agent_end', async () => {
    const logger = makeLogger() as unknown as Parameters<typeof createLearningProposalObserver>[0]['logger']
    const observer = createLearningProposalObserver({
      organizationId: 'org-1',
      agentId: 'agt-1',
      conversationId: 'conv-1',
      logger,
    })

    const events: AgentEvent[] = [
      {
        type: 'agent_start',
        ...baseFields(),
        agentId: 'agt-1',
        trigger: 'supervisor',
        triggerPayload: {
          trigger: 'supervisor',
          conversationId: 'conv-1',
          noteId: 'note-1',
          authorUserId: 'user-staff-1',
        },
        systemHash: 'h',
      },
      { type: 'agent_end', ...baseFields(), reason: 'complete' },
    ]
    for (const ev of events) await observer(ev)

    expect(insertCalls).toHaveLength(1)
    const call = insertCalls[0]!
    expect(call.resourceModule).toBe('agents')
    expect(call.resourceType).toBe('agent_memory')
    expect(call.resourceId).toBe('agt-1')
    expect(call.changedBy).toBe('agent:agt-1')
    expect(call.changedByKind).toBe('agent')
    expect(call.conversationId).toBe('conv-1')
    const payload = call.payload as { kind: string; mode: string; field: string; body: string }
    expect(payload.kind).toBe('markdown_patch')
    expect(payload.mode).toBe('append')
    expect(payload.field).toBe('workingMemory')
    expect(payload.body).toContain('supervisor')
  })

  it('enqueues two proposals when supervisor + internal_note both fire', async () => {
    const logger = makeLogger() as unknown as Parameters<typeof createLearningProposalObserver>[0]['logger']
    const observer = createLearningProposalObserver({
      organizationId: 'org-1',
      agentId: 'agt-1',
      conversationId: 'conv-1',
      logger,
    })

    const events: AgentEvent[] = [
      {
        type: 'agent_start',
        ...baseFields(),
        agentId: 'agt-1',
        trigger: 'supervisor',
        triggerPayload: {
          trigger: 'supervisor',
          conversationId: 'conv-1',
          noteId: 'note-1',
          authorUserId: 'user-staff-1',
        },
        systemHash: 'h',
      },
      { type: 'internal_note_added', ...baseFields(), noteId: 'note-2', authorType: 'staff' },
      { type: 'agent_end', ...baseFields(), reason: 'complete' },
    ]
    for (const ev of events) await observer(ev)

    expect(insertCalls).toHaveLength(2)
    expect((insertCalls[0]!.payload as { body: string }).body).toContain('supervisor')
    expect((insertCalls[1]!.payload as { body: string }).body).toContain('internal_note')
  })

  it('skips reassignment_note signals', async () => {
    const logger = makeLogger() as unknown as Parameters<typeof createLearningProposalObserver>[0]['logger']
    const observer = createLearningProposalObserver({
      organizationId: 'org-1',
      agentId: 'agt-1',
      conversationId: 'conv-1',
      logger,
    })

    const events: AgentEvent[] = [
      {
        type: 'agent_start',
        ...baseFields(),
        agentId: 'agt-1',
        trigger: 'manual',
        triggerPayload: {
          trigger: 'manual',
          conversationId: 'conv-1',
          reason: 'Reassigned to billing',
          actorUserId: 'user-staff-2',
        },
        systemHash: 'h',
      },
      { type: 'agent_end', ...baseFields(), reason: 'complete' },
    ]
    for (const ev of events) await observer(ev)

    expect(insertCalls).toHaveLength(0)
  })
})
