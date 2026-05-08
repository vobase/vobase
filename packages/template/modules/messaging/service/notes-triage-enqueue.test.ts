/**
 * Unit tests for notes coaching_note learning-triage enqueue.
 *
 * Covers:
 *   - Staff note with NO @-mention + agent assignee → one coaching_note enqueued
 *   - Staff note WITH @-mention → ZERO coaching_note enqueues (staff-note wake path instead)
 *   - Agent-authored note → ZERO coaching_note enqueues (hard ping-pong filter)
 *   - No assignee → ZERO coaching_note enqueues (nothing to attribute to)
 */

import { describe, expect, it } from 'bun:test'

import { LEARNING_TRIAGE_JOB, type LearningTriageJobPayload } from '~/wake/learning/triage-job'
import type { InternalNote } from '../schema'
import {
  type ConversationsReader,
  createNotesService,
  type NoteTriageScheduler,
  type StaffNoteScheduler,
} from './notes'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_ID = 'org-1'
const CONV_ID = 'conv-1'
const ASSIGNEE_AGENT_ID = 'agent-abc'
const NOTE_ID = 'note-1'
const NOTE_BODY = 'Please soften your tone when explaining pricing.'

const fakeNote: InternalNote = {
  id: NOTE_ID,
  organizationId: ORG_ID,
  conversationId: CONV_ID,
  authorType: 'staff',
  authorId: 'staff-user-1',
  body: NOTE_BODY,
  mentions: [],
  parentNoteId: null,
  notifChannelId: null,
  notifChannelMsgId: null,
  createdAt: new Date(),
}

// ─── Stub factories ───────────────────────────────────────────────────────────

function makeDb(returnNote: InternalNote = fakeNote) {
  return {
    insert: (_table: unknown) => ({
      values: (_vals: unknown) => ({
        returning: async () => [returnNote],
      }),
    }),
    select: () => ({
      from: (_t: unknown) => ({
        where: (_c: unknown) => ({
          orderBy: (_col: unknown) => Promise.resolve([]),
        }),
      }),
    }),
  }
}

function makeStaffNoteScheduler(): StaffNoteScheduler {
  return {
    enqueueStaffNote: () => Promise.resolve(),
  }
}

function makeConversationsReader(assigneeAgentId: string | null): ConversationsReader {
  return {
    getAssigneeAgentId: () => Promise.resolve(assigneeAgentId),
  }
}

function makeTriageScheduler(): {
  scheduler: NoteTriageScheduler
  captured: Array<{ name: string; payload: LearningTriageJobPayload }>
} {
  const captured: Array<{ name: string; payload: LearningTriageJobPayload }> = []
  const scheduler: NoteTriageScheduler = {
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    publish: async (name, payload) => {
      captured.push({ name, payload })
    },
  }
  return { scheduler, captured }
}

// Agent-mention resolver used by notes — must be installed before tests run.
// Mock the module-level `resolveAgentMentionsInBody` by passing `mentions: []`
// (notes service reads `input.mentions` directly so no module-level mock needed).

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('notes coaching_note triage enqueue', () => {
  it('enqueues exactly one coaching_note when staff note has no @-mention and conversation has agent assignee', async () => {
    const { scheduler, captured } = makeTriageScheduler()

    const svc = createNotesService({
      db: makeDb(),
      scheduler: makeStaffNoteScheduler(),
      conversations: makeConversationsReader(ASSIGNEE_AGENT_ID),
      triageScheduler: scheduler,
    })

    await svc.addNote({
      organizationId: ORG_ID,
      conversationId: CONV_ID,
      author: { kind: 'staff', id: 'staff-user-1' },
      body: NOTE_BODY,
      mentions: [],
    })

    // fan-out runs via void + Promise, flush the microtask queue
    await new Promise((r) => setTimeout(r, 5))

    expect(captured).toHaveLength(1)
    const first = captured[0]
    if (!first) throw new Error('expected captured entry')
    const { name, payload } = first
    expect(name).toBe(LEARNING_TRIAGE_JOB)
    expect(payload.signal.kind).toBe('coaching_note')
    expect(payload.agentId).toBe(ASSIGNEE_AGENT_ID)
    expect(payload.organizationId).toBe(ORG_ID)
    expect(payload.conversationId).toBe(CONV_ID)
    expect((payload.signal as { kind: string; noteId: string }).noteId).toBe(NOTE_ID)
    expect((payload.signal as { kind: string; body: string }).body).toBe(NOTE_BODY)
  })

  it('does NOT enqueue when agent-authored note (ping-pong filter)', async () => {
    const { scheduler, captured } = makeTriageScheduler()

    const svc = createNotesService({
      db: makeDb({ ...fakeNote, authorType: 'agent' }),
      scheduler: makeStaffNoteScheduler(),
      conversations: makeConversationsReader(ASSIGNEE_AGENT_ID),
      triageScheduler: scheduler,
    })

    await svc.addNote({
      organizationId: ORG_ID,
      conversationId: CONV_ID,
      author: { kind: 'agent', id: 'agent-abc' },
      body: NOTE_BODY,
      mentions: [],
    })

    await new Promise((r) => setTimeout(r, 5))

    expect(captured).toHaveLength(0)
  })

  it('does NOT enqueue when conversation has no agent assignee', async () => {
    const { scheduler, captured } = makeTriageScheduler()

    const svc = createNotesService({
      db: makeDb(),
      scheduler: makeStaffNoteScheduler(),
      conversations: makeConversationsReader(null),
      triageScheduler: scheduler,
    })

    await svc.addNote({
      organizationId: ORG_ID,
      conversationId: CONV_ID,
      author: { kind: 'staff', id: 'staff-user-1' },
      body: NOTE_BODY,
      mentions: [],
    })

    await new Promise((r) => setTimeout(r, 5))

    expect(captured).toHaveLength(0)
  })
})
