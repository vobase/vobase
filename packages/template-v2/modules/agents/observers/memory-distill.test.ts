/**
 * memoryDistillObserver tests.
 *
 * Focus: the "anti-lessons" path — when a wake records
 * `learning_rejected` events, the observer appends/merges entries into the
 * agent's `## Anti-lessons` section on agent_end. Distillation path (LLM call
 * + contact notes upsert) is covered through the debounce stub.
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { AgentEndEvent, LearningRejectedEvent, MessageEndEvent } from '@server/contracts/event'
import type { ObserverContext } from '@server/contracts/observer'
import type { ScopedDb } from '@server/contracts/scoped-db'
import { getTableName } from 'drizzle-orm'

let contactUpserts: Array<{ heading: string; body: string }> = []

mock.module('@modules/contacts/service/contacts', () => ({
  readNotes: async () => '',
  upsertNotesSection: async (_id: string, heading: string, body: string) => {
    contactUpserts.push({ heading, body })
  },
}))

mock.module('@modules/team/service/staff', () => ({
  readNotes: async () => '',
  upsertNotesSection: async () => {},
}))

// Must import AFTER mock.module
const { createMemoryDistillObserver } = await import('./memory-distill')

let currentWorkingMemory = ''
let workingMemoryWrites: string[] = []
let proposalRows: Array<{
  id: string
  target: string
  scope: string
  decidedNote: string | null
  decidedAt: Date | null
}> = []

function tableNameOf(t: unknown): string {
  try {
    return getTableName(t as Parameters<typeof getTableName>[0])
  } catch {
    return 'unknown'
  }
}

function makeCtx(): ObserverContext {
  const db = {
    select: (_cols?: unknown) => ({
      from: (t: unknown) => ({
        where: (_c: unknown) => {
          const tn = tableNameOf(t)
          const rows = tn === 'agent_definitions' ? [{ workingMemory: currentWorkingMemory }] : proposalRows
          return Object.assign(Promise.resolve(rows), {
            limit: (_n: number) => Promise.resolve(rows),
          })
        },
      }),
    }),
    update: (t: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async (_c: unknown) => {
          if (tableNameOf(t) === 'agent_definitions' && typeof values.workingMemory === 'string') {
            workingMemoryWrites.push(values.workingMemory)
            currentWorkingMemory = values.workingMemory
          }
        },
      }),
    }),
  }

  return {
    organizationId: 'org-1',
    conversationId: 'conv-1',
    wakeId: 'wake-1',
    db: db as unknown as ScopedDb,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    realtime: { notify: () => {}, subscribe: () => () => {} },
  }
}

function baseFields() {
  return {
    ts: new Date('2026-04-19T10:00:00Z'),
    wakeId: 'wake-1',
    conversationId: 'conv-1',
    organizationId: 'org-1',
    turnIndex: 0,
  }
}

function rejectedEvent(proposalId: string): LearningRejectedEvent {
  return {
    type: 'learning_rejected',
    ...baseFields(),
    proposalId,
    reason: 'staff_rejected',
  }
}

function agentEndEvent(): AgentEndEvent {
  return { type: 'agent_end', ...baseFields(), reason: 'complete' }
}

function assistantMessageEvent(content: string): MessageEndEvent {
  return {
    type: 'message_end',
    ...baseFields(),
    messageId: 'msg-1',
    role: 'assistant',
    content,
  }
}

beforeEach(() => {
  currentWorkingMemory = ''
  workingMemoryWrites = []
  proposalRows = []
  contactUpserts = []
})

describe('memoryDistillObserver — anti-lessons', () => {
  it('appends anti-lessons section when a rejection occurs during wake', async () => {
    proposalRows = [
      {
        id: 'prop-1',
        target: 'refund-procedure',
        scope: 'agent_skill',
        decidedNote: 'too risky',
        decidedAt: new Date('2026-04-19T10:05:00Z'),
      },
    ]

    const obs = createMemoryDistillObserver({ target: { kind: 'contact', contactId: 'contact-1' }, agentId: 'agt-1' })
    const _ctx = makeCtx()

    await obs.handle(rejectedEvent('prop-1'))
    await obs.handle(agentEndEvent())

    expect(workingMemoryWrites).toHaveLength(1)
    const written = workingMemoryWrites[0] ?? ''
    expect(written).toContain('## Anti-lessons')
    expect(written).toContain('agent_skill:refund-procedure')
    expect(written).toContain('too risky')
  })

  it('does not write anti-lessons when agentId is missing', async () => {
    proposalRows = [
      {
        id: 'prop-2',
        target: 'x',
        scope: 'agent_skill',
        decidedNote: null,
        decidedAt: new Date(),
      },
    ]

    const obs = createMemoryDistillObserver({ target: { kind: 'contact', contactId: 'contact-1' } })
    const _ctx = makeCtx()

    await obs.handle(rejectedEvent('prop-2'))
    await obs.handle(agentEndEvent())

    expect(workingMemoryWrites).toEqual([])
  })

  it('skips the DB write when the rejected proposal id is already recorded', async () => {
    proposalRows = [
      {
        id: 'prop-3',
        target: 'refund',
        scope: 'agent_skill',
        decidedNote: 'already rejected',
        decidedAt: new Date('2026-04-19T09:00:00Z'),
      },
    ]
    currentWorkingMemory = [
      '# Working memory',
      '',
      '## Anti-lessons',
      '',
      '- `[prop-3]` **agent_skill:refund** — already rejected _(rejected 2026-04-19T09:00:00.000Z)_',
      '',
      '## Other',
      '',
      'keep me',
    ].join('\n')

    const obs = createMemoryDistillObserver({ target: { kind: 'contact', contactId: 'contact-1' }, agentId: 'agt-1' })
    const _ctx = makeCtx()

    await obs.handle(rejectedEvent('prop-3'))
    await obs.handle(agentEndEvent())

    expect(workingMemoryWrites).toEqual([])
  })

  it('appends a fresh rejection line without disturbing earlier entries', async () => {
    proposalRows = [
      {
        id: 'prop-4',
        target: 'deposit',
        scope: 'agent_skill',
        decidedNote: 'out of scope',
        decidedAt: new Date('2026-04-19T10:00:00Z'),
      },
    ]
    currentWorkingMemory = [
      '## Anti-lessons',
      '',
      '- `[prop-3]` **agent_skill:refund** — already rejected _(rejected 2026-04-19T09:00:00.000Z)_',
    ].join('\n')

    const obs = createMemoryDistillObserver({ target: { kind: 'contact', contactId: 'contact-1' }, agentId: 'agt-1' })
    const _ctx = makeCtx()

    await obs.handle(rejectedEvent('prop-4'))
    await obs.handle(agentEndEvent())

    expect(workingMemoryWrites).toHaveLength(1)
    const written = workingMemoryWrites[0] ?? ''
    expect(written).toContain('[prop-3]')
    expect(written).toContain('[prop-4]')
    expect(written).toContain('agent_skill:deposit')
  })

  it('skips anti-lessons write when no rejections observed', async () => {
    const obs = createMemoryDistillObserver({ target: { kind: 'contact', contactId: 'contact-1' }, agentId: 'agt-1' })
    const _ctx = makeCtx()

    await obs.handle(assistantMessageEvent('hi'))
    await obs.handle(agentEndEvent())

    expect(workingMemoryWrites).toEqual([])
  })
})
