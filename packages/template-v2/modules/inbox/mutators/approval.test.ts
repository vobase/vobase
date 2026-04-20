/**
 * approvalMutator tests.
 *
 * send_card + card_approval_required=true  → returns { action:'block', ... } + inserts pending_approvals row
 * send_card + card_approval_required=false → returns undefined
 * non-gated tool name                      → returns undefined immediately
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import type { AgentStep, MutatorContext } from '@server/contracts/mutator'
import type { ScopedDb } from '@server/contracts/scoped-db'
import { approvalMutator } from './approval'

type PendingRow = {
  id: string
  organizationId: string
  conversationId: string
  toolName: string
  toolArgs: unknown
  agentSnapshot: unknown
  wakeId: string | null
  status: string
}

let pendingStore: PendingRow[] = []

beforeEach(() => {
  pendingStore = []
})

/**
 * The mutator calls (in order):
 *   1. db.select().from(conversations).where(eq(id, convId)).limit(1)
 *   2. db.select().from(agentDefinitions).where(eq(id, agentId)).limit(1)
 *   3. db.insert(pendingApprovals).values({...}).returning()
 *
 * We track selectCallCount to return the right row per call index.
 */
function makeMockDb(opts: { cardApprovalRequired: boolean; agentId: string; conversationId: string }): unknown {
  const convRow = { id: opts.conversationId, assignee: `agent:${opts.agentId}` }
  const agentRow: Record<string, unknown> = {
    id: opts.agentId,
    cardApprovalRequired: opts.cardApprovalRequired,
    fileApprovalRequired: true,
    bookSlotApprovalRequired: true,
  }

  let selectCallCount = 0

  return {
    select: () => {
      selectCallCount++
      const callIndex = selectCallCount
      return {
        from: (_table: unknown) => ({
          where: (_cond: unknown) => ({
            limit: (_n: number): Promise<unknown[]> => {
              if (callIndex === 1) return Promise.resolve([convRow])
              if (callIndex === 2) return Promise.resolve([agentRow])
              return Promise.resolve([])
            },
          }),
        }),
      }
    },
    insert: (_table: unknown) => ({
      values: (v: unknown) => {
        const row = v as Record<string, unknown>
        const pending: PendingRow = {
          id: String(row.id ?? 'pa-test'),
          status: 'pending',
          wakeId: String(row.wakeId ?? null),
          organizationId: String(row.organizationId ?? ''),
          conversationId: String(row.conversationId ?? ''),
          toolName: String(row.toolName ?? ''),
          toolArgs: row.toolArgs,
          agentSnapshot: row.agentSnapshot,
        }
        pendingStore.push(pending)
        return { returning: () => Promise.resolve([pending]) }
      },
    }),
  }
}

function makeCtx(opts: { cardApprovalRequired: boolean; agentId?: string; conversationId?: string }): MutatorContext {
  const agentId = opts.agentId ?? 'agt-test'
  const conversationId = opts.conversationId ?? 'conv-test'

  return {
    organizationId: 'org-test',
    conversationId,
    wakeId: 'wake-test',
    ports: {} as MutatorContext['ports'],
    db: makeMockDb({ cardApprovalRequired: opts.cardApprovalRequired, agentId, conversationId }) as ScopedDb,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    realtime: { notify: () => {} },
    llmCall: async () => {
      throw new Error('not expected')
    },
    persistEvent: async () => {},
  }
}

function makeStep(toolName: string, args: unknown = {}): AgentStep {
  return { toolCallId: 'tc-1', toolName, args }
}

describe('approvalMutator', () => {
  it('has stable id', () => {
    expect(approvalMutator.id).toBe('inbox:approval')
  })

  it('returns undefined for non-gated tool reply', async () => {
    const ctx = makeCtx({ cardApprovalRequired: true })
    const result = await approvalMutator.before?.(makeStep('reply', { text: 'hello' }), ctx)
    expect(result).toBeUndefined()
  })

  it('returns undefined for non-gated tool bash', async () => {
    const ctx = makeCtx({ cardApprovalRequired: true })
    const result = await approvalMutator.before?.(makeStep('bash', { command: 'ls' }), ctx)
    expect(result).toBeUndefined()
  })

  it('returns { action: block } when send_card + card_approval_required=true', async () => {
    const ctx = makeCtx({ cardApprovalRequired: true })
    const step = makeStep('send_card', { type: 'card', title: 'Test', children: [] })
    const result = await approvalMutator.before?.(step, ctx)

    expect(result).toBeDefined()
    expect(result?.action).toBe('block')
    const blockResult = result as { action: 'block'; reason: string }
    expect(blockResult.reason).toMatch(/^pending_approval:/)
  })

  it('inserts one pending_approvals row when blocking', async () => {
    const ctx = makeCtx({ cardApprovalRequired: true })
    const step = makeStep('send_card', { type: 'card', title: 'Refund', children: [] })
    await approvalMutator.before?.(step, ctx)

    expect(pendingStore).toHaveLength(1)
    expect(pendingStore[0].toolName).toBe('send_card')
    expect(pendingStore[0].agentSnapshot).toBeTruthy()
  })

  it('pending_approvals row has wakeId populated', async () => {
    const ctx = makeCtx({ cardApprovalRequired: true })
    const step = makeStep('send_card', { type: 'card', title: 'Refund', children: [] })
    await approvalMutator.before?.(step, ctx)

    expect(pendingStore[0].wakeId).toBe('wake-test')
  })

  it('returns undefined when card_approval_required=false', async () => {
    const ctx = makeCtx({ cardApprovalRequired: false })
    const step = makeStep('send_card', { type: 'card', title: 'Info', children: [] })
    const result = await approvalMutator.before?.(step, ctx)
    expect(result).toBeUndefined()
  })
})
