/**
 * learning-proposals service tests.
 *
 * Covers `insertProposal`, `decideProposal` (threat_scan + scope-routed writes
 * + NOTIFY), and `listRecent`. Mocks the Drizzle handle so we can assert the
 * exact queries each branch emits.
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import { getTableName } from 'drizzle-orm'
import { createJournalService, installJournalService } from './journal'
import {
  decideProposal,
  insertProposal,
  listRecent,
  type NotifyFn,
  type ProposalRow,
  setDb,
  setNotifier,
} from './learning-proposals'

interface InsertCapture {
  table: string
  values: Record<string, unknown>
}
interface UpdateCapture {
  table: string
  values: Record<string, unknown>
}

let inserts: InsertCapture[] = []
let updates: UpdateCapture[] = []
let notifyCalls: Array<{ channel: string; payload: string }> = []
let currentProposal: ProposalRow | null = null
let recentProposals: ProposalRow[] = []
let agentStartRows: Array<{ payload: unknown; toolCalls: unknown }> = []
let turnIndexRows: Array<{ turnIndex: number }> = []

function tableName(t: unknown): string {
  try {
    return getTableName(t as Parameters<typeof getTableName>[0])
  } catch {
    return 'unknown'
  }
}

/** Build a thenable that also exposes `.limit` + `.orderBy` — mirrors Drizzle's chainable+awaitable builder shape. */
function buildSelectChain(rows: unknown[]): Record<string, unknown> {
  const chain: Record<string, unknown> = {
    limit: (_n: number) => Promise.resolve(rows),
    orderBy: (_o: unknown) => buildSelectChain(rows),
    catch: (onRejected: (e: unknown) => unknown) => Promise.resolve(rows).catch(onRejected),
  }
  // biome-ignore lint/suspicious/noThenProperty: deliberate thenable to mirror Drizzle's awaitable builder
  chain.then = (onFulfilled: (v: unknown) => unknown) => Promise.resolve(rows).then(onFulfilled)
  return chain
}

function makeDb(): unknown {
  const db: Record<string, unknown> = {
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
    insert: (table: unknown) => ({
      values: (row: Record<string, unknown>) => {
        inserts.push({ table: tableName(table), values: row })
        const p: Record<string, unknown> = {
          catch: (onRejected: (e: unknown) => unknown) => Promise.resolve().catch(onRejected),
          returning: () => Promise.resolve([row]),
        }
        // biome-ignore lint/suspicious/noThenProperty: .values(...) is both awaitable and has .returning() — mirror Drizzle's chainable+awaitable builder
        p.then = (onFulfilled: (v: unknown) => unknown) => Promise.resolve().then(onFulfilled)
        return p
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (_c: unknown) => {
          updates.push({ table: tableName(table), values })
          return Promise.resolve()
        },
      }),
    }),
    select: (cols?: unknown) => ({
      from: (table: unknown) => {
        const name = tableName(table)
        return {
          where: (_c: unknown) => {
            if (name === 'learning_proposals') {
              const rows = currentProposal ? [currentProposal] : recentProposals
              return buildSelectChain(rows)
            }
            if (name === 'conversation_events') {
              const colObj = (cols as Record<string, unknown> | undefined) ?? {}
              const isTurnIndexQuery = Object.hasOwn(colObj, 'turnIndex')
              const rows = isTurnIndexQuery ? turnIndexRows : agentStartRows
              return buildSelectChain(rows)
            }
            return buildSelectChain([])
          },
        }
      },
    }),
    execute: (_s: unknown) => Promise.resolve(),
  }
  return db
}

function mockNotifier(): NotifyFn {
  return (channel, payload) => {
    notifyCalls.push({ channel, payload })
  }
}

function makePendingProposal(overrides: Partial<ProposalRow> = {}): ProposalRow {
  return {
    id: 'prop-1',
    organizationId: 'org-1',
    conversationId: 'conv-1',
    scope: 'agent_skill',
    action: 'create',
    target: 'refund-procedure',
    body: 'Follow these steps…',
    rationale: 'staff kept correcting',
    confidence: 0.8,
    status: 'pending',
    decidedByUserId: null,
    decidedAt: null,
    decidedNote: null,
    approvedWriteId: null,
    createdAt: new Date(),
    ...overrides,
  }
}

beforeEach(() => {
  inserts = []
  updates = []
  notifyCalls = []
  currentProposal = null
  recentProposals = []
  agentStartRows = []
  turnIndexRows = [{ turnIndex: 2 }]
  const db = makeDb()
  setDb(db)
  setNotifier(mockNotifier())
  // biome-ignore lint/suspicious/noExplicitAny: mock db satisfies runtime shape, not full Drizzle types
  installJournalService(createJournalService({ db: db as any }))
})

describe('insertProposal', () => {
  it('defaults status to pending for agent_skill scope', async () => {
    await insertProposal({
      organizationId: 'org-1',
      conversationId: 'conv-1',
      scope: 'agent_skill',
      action: 'create',
      target: 'refund-procedure',
    })
    expect(inserts).toHaveLength(1)
    expect(inserts[0]?.values.status).toBe('pending')
  })

  it('defaults status to auto_written for contact scope', async () => {
    await insertProposal({
      organizationId: 'org-1',
      conversationId: 'conv-1',
      scope: 'contact',
      action: 'upsert',
      target: 'preferences',
    })
    expect(inserts[0]?.values.status).toBe('auto_written')
  })

  it('honours explicit status override', async () => {
    await insertProposal({
      organizationId: 'org-1',
      conversationId: 'conv-1',
      scope: 'agent_skill',
      action: 'create',
      target: 'x',
      status: 'auto_written',
    })
    expect(inserts[0]?.values.status).toBe('auto_written')
  })

  it('returns the generated id', async () => {
    const { id } = await insertProposal({
      organizationId: 'org-1',
      conversationId: 'conv-1',
      scope: 'agent_skill',
      action: 'create',
      target: 'x',
    })
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })
})

describe('decideProposal', () => {
  it('throws when proposal is missing', async () => {
    currentProposal = null
    await expect(decideProposal('missing-id', 'approved', 'user-1')).rejects.toThrow(/not found/)
  })

  it('throws when proposal is not pending', async () => {
    currentProposal = makePendingProposal({ status: 'approved' })
    await expect(decideProposal('prop-1', 'approved', 'user-1')).rejects.toThrow(/not pending/)
  })

  it('on reject: emits learning_rejected journal event and notify', async () => {
    currentProposal = makePendingProposal()
    const result = await decideProposal('prop-1', 'rejected', 'user-1', 'not useful')
    expect(result.status).toBe('rejected')
    expect(result.writeId).toBeNull()

    const journalInsert = inserts.find((i) => i.table === 'conversation_events')
    expect(journalInsert?.values.type).toBe('learning_rejected')
    expect(journalInsert?.values.payload).toMatchObject({ proposalId: 'prop-1', reason: 'not useful' })

    expect(notifyCalls.map((n) => n.channel)).toEqual(['learnings:refresh'])
    expect(JSON.parse(notifyCalls[0]?.payload ?? '{}')).toMatchObject({ proposalId: 'prop-1', status: 'rejected' })
  })

  it('on approve (agent_skill): inserts learnedSkills + journal learning_approved + skills:invalidate NOTIFY', async () => {
    currentProposal = makePendingProposal({ scope: 'agent_skill' })
    agentStartRows = [{ payload: { agentId: 'agt-xyz' }, toolCalls: null }]

    const result = await decideProposal('prop-1', 'approved', 'user-1')
    expect(result.status).toBe('approved')
    expect(result.writeId).toMatch(/^.+$/) // non-empty skill id

    const skillInsert = inserts.find((i) => i.table === 'learned_skills')
    expect(skillInsert).toBeDefined()
    expect(skillInsert?.values).toMatchObject({
      organizationId: 'org-1',
      agentId: 'agt-xyz',
      name: 'refund-procedure',
      parentProposalId: 'prop-1',
    })

    const journalInsert = inserts.find((i) => i.table === 'conversation_events')
    expect(journalInsert?.values.type).toBe('learning_approved')

    expect(notifyCalls.map((n) => n.channel)).toEqual(['skills:invalidate'])
  })

  it('on approve (drive_doc): uses drive:invalidate channel + writeId=drive:<target>', async () => {
    currentProposal = makePendingProposal({ scope: 'drive_doc', target: 'playbooks/refund.md' })

    const result = await decideProposal('prop-1', 'approved', 'user-1')
    expect(result.status).toBe('approved')
    expect(result.writeId).toBe('drive:playbooks/refund.md')
    expect(notifyCalls.map((n) => n.channel)).toEqual(['drive:invalidate'])
  })

  it('swallows notifier errors (best-effort)', async () => {
    currentProposal = makePendingProposal()
    setNotifier(() => {
      throw new Error('boom')
    })
    const result = await decideProposal('prop-1', 'rejected', 'user-1')
    expect(result.status).toBe('rejected')
  })

  it('is a no-op when no notifier is wired', async () => {
    setNotifier(null)
    currentProposal = makePendingProposal()
    const result = await decideProposal('prop-1', 'rejected', 'user-1')
    expect(result.status).toBe('rejected')
    expect(notifyCalls).toEqual([])
  })
})

describe('listRecent', () => {
  it('returns rows for organization when no status filter', async () => {
    const rows = [makePendingProposal(), makePendingProposal({ id: 'prop-2' })]
    recentProposals = rows
    const result = await listRecent('org-1')
    expect(result).toHaveLength(2)
    expect(result[0]?.id).toBe('prop-1')
  })

  it('applies status filter', async () => {
    recentProposals = [makePendingProposal({ status: 'approved' })]
    const result = await listRecent('org-1', 'approved')
    expect(result[0]?.status).toBe('approved')
  })
})
