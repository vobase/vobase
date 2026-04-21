/**
 * learningProposalObserver — observer tests.
 *
 * Asserts:
 *   - Fires exactly once per qualifying wake (agent_end gate)
 *   - Skips non-qualifying wakes (no staff signals)
 *   - contact scope triggers ContactsService.upsertNotesSection + auto_written row
 *   - agent_skill scope inserts status=pending + emits learning_proposed (no auto-approve)
 *   - auto-write scopes emit synthetic learning_approved
 *   - Swallows single-proposal errors without crashing the batch
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { AgentEvent } from '@server/contracts/event'
import type { ObserverContext } from '@server/contracts/observer'
import type { LlmResult, PluginContext } from '@server/contracts/plugin-context'
import type { ScopedDb } from '@server/contracts/scoped-db'
import { getTableName } from 'drizzle-orm'
import { setDb as setLearningProposalsDb } from '../service/learning-proposals'

/** Module-level captures populated by mock.module stubs. */
let contactUpserts: Array<{ contactId: string; heading: string; body: string }> = []
let journalEvents: AgentEvent[] = []
let upsertThrowOnCall = 0 // when > 0, throw on that call number

let upsertCallCount = 0
mock.module('@modules/contacts/service/contacts', () => ({
  upsertNotesSection: async (contactId: string, heading: string, body: string) => {
    upsertCallCount++
    if (upsertThrowOnCall > 0 && upsertCallCount === upsertThrowOnCall) throw new Error('boom')
    contactUpserts.push({ contactId, heading, body })
  },
}))

mock.module('@modules/agents/service/journal', () => ({
  append: async (opts: { event: AgentEvent }) => {
    journalEvents.push(opts.event)
  },
}))

// Must import AFTER mock.module
const { createLearningProposalObserver, upsertMarkdownSection } = await import('./learning-proposal')

let llmCallLog: Array<{ task: string; user: string }> = []
let nextProposalsRaw = '{"proposals":[]}'
let recentAgentMemory = ''
let agentMemoryUpdates: Array<{ id: string; workingMemory: string }> = []
let serviceInsertCalls: Array<Record<string, unknown>> = []

/** Service-side stub DB: captures inserts into learning_proposals. */
function installServiceDb(): void {
  const serviceDb = {
    insert: (t: unknown) => {
      const tn = tableNameOf(t)
      return {
        values: (row: Record<string, unknown>) => {
          if (tn === 'learning_proposals') serviceInsertCalls.push(row)
          return { returning: () => Promise.resolve([row]) }
        },
      }
    },
  }
  setLearningProposalsDb(serviceDb)
}

function tableNameOf(t: unknown): string {
  try {
    return getTableName(t as Parameters<typeof getTableName>[0])
  } catch {
    return 'unknown'
  }
}

function mockLlmCall(...args: unknown[]): Promise<LlmResult<string>> {
  const [task, req] = args as [string, { messages?: Array<{ content: string }> }]
  llmCallLog.push({ task, user: req.messages?.[0]?.content ?? '' })
  return Promise.resolve({
    task: task as LlmResult<string>['task'],
    model: 'test-model',
    provider: 'test',
    content: nextProposalsRaw,
    tokensIn: 1,
    tokensOut: 1,
    cacheReadTokens: 0,
    costUsd: 0,
    latencyMs: 1,
    cacheHit: false,
  })
}

function makeDbAndLogger(): Pick<ObserverContext, 'db' | 'logger' | 'realtime'> {
  const db = {
    select: (_cols?: unknown) => ({
      from: (t: unknown) => ({
        where: (_c: unknown) => {
          const tn = (() => {
            try {
              return getTableName(t as Parameters<typeof getTableName>[0])
            } catch {
              return 'unknown'
            }
          })()
          const rows = tn === 'agent_definitions' ? [{ workingMemory: recentAgentMemory }] : []
          return Object.assign(Promise.resolve(rows), {
            limit: (_n: number) => Promise.resolve(rows),
          })
        },
      }),
    }),
    update: (_t: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async (_c: unknown) => {
          const wm = values.workingMemory
          if (typeof wm === 'string') {
            agentMemoryUpdates.push({ id: 'agt-1', workingMemory: wm })
            recentAgentMemory = wm
          }
        },
      }),
    }),
    insert: (_t: unknown) => ({
      values: (_row: Record<string, unknown>) => ({
        returning: () => Promise.resolve([]),
      }),
    }),
  }

  const realtime: ObserverContext['realtime'] = { notify: () => {}, subscribe: () => () => {} }
  const logger: ObserverContext['logger'] = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }

  return { db: db as unknown as ScopedDb, logger, realtime }
}

function makeCtx(): ObserverContext {
  const base = makeDbAndLogger()
  return {
    organizationId: 'org-1',
    conversationId: 'conv-1',
    wakeId: 'wake-1',
    ...base,
  }
}

function baseFields(wakeId = 'wake-1') {
  return {
    ts: new Date('2026-04-19T10:00:00Z'),
    wakeId,
    conversationId: 'conv-1',
    organizationId: 'org-1',
    turnIndex: 0,
  }
}

function supervisorStart(wakeId = 'wake-1'): AgentEvent {
  return {
    type: 'agent_start',
    ...baseFields(wakeId),
    agentId: 'agt-1',
    trigger: 'supervisor',
    triggerPayload: {
      trigger: 'supervisor',
      conversationId: 'conv-1',
      noteId: 'note-1',
      authorUserId: 'user-staff-1',
    },
    systemHash: 'hash',
  }
}

function agentEnd(wakeId = 'wake-1'): AgentEvent {
  return { type: 'agent_end', ...baseFields(wakeId), reason: 'complete' }
}

beforeEach(() => {
  llmCallLog = []
  nextProposalsRaw = '{"proposals":[]}'
  recentAgentMemory = ''
  agentMemoryUpdates = []
  serviceInsertCalls = []
  contactUpserts = []
  journalEvents = []
  upsertCallCount = 0
  upsertThrowOnCall = 0
  installServiceDb()
})

describe('createLearningProposalObserver', () => {
  it('has stable id', () => {
    const obs = createLearningProposalObserver({
      contactId: 'contact-1',
      agentId: 'agt-1',
      llmCall: mockLlmCall as unknown as PluginContext['llmCall'],
    })
    expect(obs.id).toBe('agents:learning-proposal')
  })

  it('no-op when wake has no staff signals', async () => {
    const obs = createLearningProposalObserver({
      contactId: 'contact-1',
      agentId: 'agt-1',
      llmCall: mockLlmCall as unknown as PluginContext['llmCall'],
    })
    const ctx = makeCtx()

    // inbound_message start (not a staff signal)
    await obs.handle(
      {
        type: 'agent_start',
        ...baseFields(),
        agentId: 'agt-1',
        trigger: 'inbound_message',
        triggerPayload: { trigger: 'inbound_message', conversationId: 'conv-1', messageIds: ['m1'] },
        systemHash: 'h',
      },
      ctx,
    )
    await obs.handle(agentEnd(), ctx)

    expect(llmCallLog).toEqual([])
    expect(serviceInsertCalls).toEqual([])
    expect(journalEvents).toEqual([])
  })

  it('fires exactly once on agent_end for a qualifying wake', async () => {
    nextProposalsRaw = JSON.stringify({
      proposals: [
        {
          scope: 'agent_skill',
          action: 'create',
          target: 'refund',
          body: '…',
          rationale: 'reason',
          confidence: 0.8,
        },
      ],
    })
    const obs = createLearningProposalObserver({
      contactId: 'contact-1',
      agentId: 'agt-1',
      llmCall: mockLlmCall as unknown as PluginContext['llmCall'],
    })
    const ctx = makeCtx()

    await obs.handle(supervisorStart(), ctx)
    await obs.handle(agentEnd(), ctx)

    // Handle agent_end AGAIN to ensure the buffer was cleared.
    await obs.handle(agentEnd(), ctx)

    expect(llmCallLog).toHaveLength(1)
    expect(llmCallLog[0]?.task).toBe('learn.propose')
  })

  it('agent_skill scope inserts pending + emits learning_proposed only', async () => {
    nextProposalsRaw = JSON.stringify({
      proposals: [
        {
          scope: 'agent_skill',
          action: 'create',
          target: 'refund-procedure',
          body: 'Steps…',
          rationale: 'Staff kept correcting',
          confidence: 0.8,
        },
      ],
    })

    const obs = createLearningProposalObserver({
      contactId: 'contact-1',
      agentId: 'agt-1',
      llmCall: mockLlmCall as unknown as PluginContext['llmCall'],
    })
    const ctx = makeCtx()

    await obs.handle(supervisorStart(), ctx)
    await obs.handle(agentEnd(), ctx)

    expect(serviceInsertCalls).toHaveLength(1)
    expect(serviceInsertCalls[0]?.status).toBe('pending')
    expect(serviceInsertCalls[0]?.scope).toBe('agent_skill')
    expect(serviceInsertCalls[0]?.target).toBe('refund-procedure')

    const types = journalEvents.map((e) => e.type)
    expect(types).toEqual(['learning_proposed'])
    expect(contactUpserts).toEqual([])
  })

  it('contact scope auto-writes via ContactsService + emits proposed + synthetic approved', async () => {
    nextProposalsRaw = JSON.stringify({
      proposals: [
        {
          scope: 'contact',
          action: 'upsert',
          target: 'Preferences',
          body: 'Likes email over phone.',
          rationale: 'Explicit staff note',
          confidence: 0.9,
        },
      ],
    })

    const obs = createLearningProposalObserver({
      contactId: 'contact-1',
      agentId: 'agt-1',
      llmCall: mockLlmCall as unknown as PluginContext['llmCall'],
    })
    const ctx = makeCtx()

    await obs.handle(supervisorStart(), ctx)
    await obs.handle(agentEnd(), ctx)

    expect(contactUpserts).toEqual([
      { contactId: 'contact-1', heading: 'Preferences', body: 'Likes email over phone.' },
    ])

    expect(serviceInsertCalls[0]?.status).toBe('auto_written')
    const types = journalEvents.map((e) => e.type)
    expect(types).toEqual(['learning_proposed', 'learning_approved'])
  })

  it('agent_memory scope auto-writes working memory via ctx.db', async () => {
    nextProposalsRaw = JSON.stringify({
      proposals: [
        {
          scope: 'agent_memory',
          action: 'upsert',
          target: 'Habits',
          body: 'Always greet by name.',
          rationale: 'Staff pattern',
          confidence: 0.7,
        },
      ],
    })
    recentAgentMemory = '## Existing\n\nsome content\n'

    const obs = createLearningProposalObserver({
      contactId: 'contact-1',
      agentId: 'agt-1',
      llmCall: mockLlmCall as unknown as PluginContext['llmCall'],
    })
    const ctx = makeCtx()

    await obs.handle(supervisorStart(), ctx)
    await obs.handle(agentEnd(), ctx)

    expect(agentMemoryUpdates).toHaveLength(1)
    expect(agentMemoryUpdates[0]?.workingMemory).toContain('## Habits')
    expect(agentMemoryUpdates[0]?.workingMemory).toContain('Always greet by name.')

    expect(serviceInsertCalls[0]?.status).toBe('auto_written')
    const types = journalEvents.map((e) => e.type)
    expect(types).toEqual(['learning_proposed', 'learning_approved'])
  })

  it('swallows per-proposal errors without aborting batch', async () => {
    nextProposalsRaw = JSON.stringify({
      proposals: [
        { scope: 'contact', action: 'upsert', target: 'A', body: 'body-a', rationale: '', confidence: 0.5 },
        { scope: 'contact', action: 'upsert', target: 'B', body: 'body-b', rationale: '', confidence: 0.5 },
      ],
    })
    const obs = createLearningProposalObserver({
      contactId: 'contact-1',
      agentId: 'agt-1',
      llmCall: mockLlmCall as unknown as PluginContext['llmCall'],
    })
    const ctx = makeCtx()
    // Fail the first upsert, succeed the second.
    upsertThrowOnCall = 1

    await obs.handle(supervisorStart(), ctx)
    await obs.handle(agentEnd(), ctx)

    // Second proposal still wrote through even though first raised.
    expect(contactUpserts).toHaveLength(1)
    expect(contactUpserts[0]?.heading).toBe('B')
  })
})

describe('upsertMarkdownSection helper', () => {
  it('appends a fresh section when missing', () => {
    const out = upsertMarkdownSection('# Memory\n\n', 'Preferences', 'contact likes email')
    expect(out).toContain('## Preferences')
    expect(out).toContain('contact likes email')
  })

  it('replaces an existing section body in place', () => {
    const input = '## Preferences\n\nold body\n\n## Other\n\nkeep\n'
    const out = upsertMarkdownSection(input, 'Preferences', 'new body')
    expect(out).toContain('new body')
    expect(out).not.toContain('old body')
    expect(out).toContain('## Other')
    expect(out).toContain('keep')
  })
})
