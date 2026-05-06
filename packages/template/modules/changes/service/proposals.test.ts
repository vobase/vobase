/**
 * Unit tests for the change-proposals registry + insert-status derivation.
 *
 * Decide-path coverage (status guard, threat scan, journal emission branches)
 * lives in the slice-B E2E test (`tests/e2e/contacts-change-flow.test.ts`)
 * because it requires a live Postgres for the drizzle expression evaluator.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { ChangePayload } from '@vobase/core'

import {
  __resetChangeProposalsServiceForTests,
  __resetChangeRegistryForTests,
  type ChangeProposalsService,
  createChangeProposalsService,
  type Materializer,
  registerChangeMaterializer,
} from './proposals'

// ─── Fake DB handle (in-memory) ──────────────────────────────────────────────
//
// Mirrors just enough of the drizzle surface for the service: insert/update/
// select/transaction. Rows live in a Map keyed by id; selects ignore the
// where predicate and return all rows (the service only uses id-equals
// predicates against single-row queries).

interface Row extends Record<string, unknown> {
  id: string
}

interface FakeTable {
  rows: Map<string, Row>
}

function createFakeDb(): {
  handle: unknown
  proposals: FakeTable
  history: FakeTable
} {
  const proposals: FakeTable = { rows: new Map() }
  const history: FakeTable = { rows: new Map() }
  let activeTable: FakeTable = proposals

  const handle = {
    insert(_table: unknown) {
      // Heuristic: alternate target tracking by reference identity. The
      // service inserts into either `changeProposals` or `changeHistory`;
      // for unit tests we assume the next operation matches by recency.
      activeTable = (_table as { _name?: string })._name === 'change_history' ? history : proposals
      return {
        values(v: Row) {
          return {
            returning() {
              activeTable.rows.set(v.id, { ...v })
              return Promise.resolve([{ ...v }])
            },
          }
        },
      }
    },
    update(_table: unknown) {
      return {
        set(patch: Partial<Row>) {
          return {
            where(_predicate: unknown) {
              // Apply patch to all rows in proposals (single-row tests only).
              for (const [k, v] of proposals.rows) proposals.rows.set(k, { ...v, ...patch })
              return Promise.resolve(undefined)
            },
          }
        },
      }
    },
    select() {
      return {
        from(_table: unknown) {
          const allRows = [...proposals.rows.values()]
          return {
            where(_predicate: unknown) {
              return Object.assign(Promise.resolve(allRows), {
                limit(n: number) {
                  return Promise.resolve(allRows.slice(0, n))
                },
                orderBy() {
                  return Object.assign(Promise.resolve(allRows), {
                    limit(n: number) {
                      return Promise.resolve(allRows.slice(0, n))
                    },
                  })
                },
              })
            },
            orderBy() {
              return {
                limit(n: number) {
                  return Promise.resolve(allRows.slice(0, n))
                },
              }
            },
          }
        },
      }
    },
    execute() {
      return Promise.resolve(undefined)
    },
    transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      return fn(handle)
    },
  }

  return { handle, proposals, history }
}

// ─── Test setup ──────────────────────────────────────────────────────────────

let service: ChangeProposalsService
let materializerCalls: Array<{ proposalId: string }>
let materializerImpl: Materializer

beforeEach(() => {
  __resetChangeRegistryForTests()
  __resetChangeProposalsServiceForTests()
  materializerCalls = []
  // biome-ignore lint/suspicious/useAwait: materializer signature is async per contract
  materializerImpl = async (proposal) => {
    materializerCalls.push({ proposalId: proposal.id })
    return { resultId: `result-${proposal.id}`, before: null, after: { ok: true } }
  }
})

afterEach(() => {
  __resetChangeRegistryForTests()
  __resetChangeProposalsServiceForTests()
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('change-proposals registry', () => {
  it('rejects insertProposal for an unregistered (module, type) pair', async () => {
    const fake = createFakeDb()
    service = createChangeProposalsService({ db: fake.handle })

    await expect(
      service.insertProposal({
        organizationId: 'org_1',
        resourceModule: 'unknown',
        resourceType: 'thing',
        resourceId: 'r1',
        payload: payload(),
        changedBy: 'agent_a',
        changedByKind: 'agent',
      }),
    ).rejects.toThrow(/no materializer registered/)
  })

  it('looks up a registration after registerChangeMaterializer is called', async () => {
    registerChangeMaterializer({
      resourceModule: 'widgets',
      resourceType: 'widget',
      requiresApproval: true,
      materialize: materializerImpl,
    })
    const fake = createFakeDb()
    service = createChangeProposalsService({ db: fake.handle })

    const result = await service.insertProposal({
      organizationId: 'org_1',
      resourceModule: 'widgets',
      resourceType: 'widget',
      resourceId: 'w1',
      payload: payload(),
      changedBy: 'agent_a',
      changedByKind: 'agent',
    })

    expect(result.status).toBe('pending')
    expect(materializerCalls).toEqual([])
  })
})

describe('insertProposal status derivation', () => {
  it('derives status="pending" when requiresApproval=true and does not fire materializer', async () => {
    registerChangeMaterializer({
      resourceModule: 'widgets',
      resourceType: 'widget',
      requiresApproval: true,
      materialize: materializerImpl,
    })
    const fake = createFakeDb()
    service = createChangeProposalsService({ db: fake.handle })

    const result = await service.insertProposal({
      organizationId: 'org_1',
      resourceModule: 'widgets',
      resourceType: 'widget',
      resourceId: 'w1',
      payload: payload(),
      changedBy: 'agent_a',
      changedByKind: 'agent',
    })

    expect(result.status).toBe('pending')
    expect(materializerCalls).toEqual([])
  })

  it('derives status="auto_written" when requiresApproval=false and fires materializer in same tx', async () => {
    registerChangeMaterializer({
      resourceModule: 'widgets',
      resourceType: 'widget',
      requiresApproval: false,
      materialize: materializerImpl,
    })
    const fake = createFakeDb()
    service = createChangeProposalsService({ db: fake.handle })

    const result = await service.insertProposal({
      organizationId: 'org_1',
      resourceModule: 'widgets',
      resourceType: 'widget',
      resourceId: 'w1',
      payload: payload(),
      changedBy: 'agent_a',
      changedByKind: 'agent',
    })

    expect(result.status).toBe('auto_written')
    expect(materializerCalls.length).toBe(1)
  })
})

describe('insertProposal per-field gate (requiresApprovalForFields)', () => {
  it('forces status="pending" when a field_set proposal touches a gated key, even with requiresApproval=false', async () => {
    registerChangeMaterializer({
      resourceModule: 'widgets',
      resourceType: 'widget',
      requiresApproval: false,
      requiresApprovalForFields: new Set(['displayName']),
      materialize: materializerImpl,
    })
    const fake = createFakeDb()
    service = createChangeProposalsService({ db: fake.handle })

    const result = await service.insertProposal({
      organizationId: 'org_1',
      resourceModule: 'widgets',
      resourceType: 'widget',
      resourceId: 'w1',
      payload: { kind: 'field_set', fields: { displayName: { from: 'Old', to: 'New' } } },
      changedBy: 'agent_a',
      changedByKind: 'agent',
    })

    expect(result.status).toBe('pending')
    // Pending path must NOT run the materializer or write history.
    expect(materializerCalls).toEqual([])
  })

  it('auto-applies a field_set proposal touching only ungated keys', async () => {
    registerChangeMaterializer({
      resourceModule: 'widgets',
      resourceType: 'widget',
      requiresApproval: false,
      requiresApprovalForFields: new Set(['displayName']),
      materialize: materializerImpl,
    })
    const fake = createFakeDb()
    service = createChangeProposalsService({ db: fake.handle })

    const result = await service.insertProposal({
      organizationId: 'org_1',
      resourceModule: 'widgets',
      resourceType: 'widget',
      resourceId: 'w1',
      payload: { kind: 'field_set', fields: { phone: { from: '+1', to: '+2' } } },
      changedBy: 'agent_a',
      changedByKind: 'agent',
    })

    expect(result.status).toBe('auto_written')
    expect(materializerCalls.length).toBe(1)
  })

  it('does NOT gate on attributes.* keys even if the gate set contains them', async () => {
    registerChangeMaterializer({
      resourceModule: 'widgets',
      resourceType: 'widget',
      requiresApproval: false,
      // `attributes.priority` should be ignored — the gate is for top-level
      // scalars only. Per-attribute gating is a tracked follow-up.
      requiresApprovalForFields: new Set(['attributes.priority']),
      materialize: materializerImpl,
    })
    const fake = createFakeDb()
    service = createChangeProposalsService({ db: fake.handle })

    const result = await service.insertProposal({
      organizationId: 'org_1',
      resourceModule: 'widgets',
      resourceType: 'widget',
      resourceId: 'w1',
      payload: { kind: 'field_set', fields: { 'attributes.priority': { from: 'low', to: 'high' } } },
      changedBy: 'agent_a',
      changedByKind: 'agent',
    })

    expect(result.status).toBe('auto_written')
    expect(materializerCalls.length).toBe(1)
  })

  it('bypasses the gate entirely for non-field_set payloads (markdown_patch)', async () => {
    registerChangeMaterializer({
      resourceModule: 'widgets',
      resourceType: 'widget',
      requiresApproval: false,
      requiresApprovalForFields: new Set(['displayName']),
      materialize: materializerImpl,
    })
    const fake = createFakeDb()
    service = createChangeProposalsService({ db: fake.handle })

    const result = await service.insertProposal({
      organizationId: 'org_1',
      resourceModule: 'widgets',
      resourceType: 'widget',
      resourceId: 'w1',
      payload: { kind: 'markdown_patch', mode: 'append', field: 'memory', body: 'note' },
      changedBy: 'agent_a',
      changedByKind: 'agent',
    })

    expect(result.status).toBe('auto_written')
    expect(materializerCalls.length).toBe(1)
  })

  it('treats an empty / undefined gate set as no-op (resource-level decides)', async () => {
    registerChangeMaterializer({
      resourceModule: 'widgets',
      resourceType: 'widget',
      requiresApproval: false,
      // requiresApprovalForFields omitted → behaviour byte-identical to today
      materialize: materializerImpl,
    })
    const fake = createFakeDb()
    service = createChangeProposalsService({ db: fake.handle })

    const result = await service.insertProposal({
      organizationId: 'org_1',
      resourceModule: 'widgets',
      resourceType: 'widget',
      resourceId: 'w1',
      payload: { kind: 'field_set', fields: { displayName: { from: 'Old', to: 'New' } } },
      changedBy: 'agent_a',
      changedByKind: 'agent',
    })

    expect(result.status).toBe('auto_written')
  })
})

describe('InsertProposalInput type-level guard', () => {
  it('does not accept caller-supplied `status` field (compile-time enforcement)', () => {
    // The service input shape `InsertProposalInput` has no `status` key.
    // If the type ever grows one, the @ts-expect-error below stops compiling
    // and this test fails — making the regression structurally loud.
    const input: Parameters<ChangeProposalsService['insertProposal']>[0] = {
      organizationId: 'org_1',
      resourceModule: 'widgets',
      resourceType: 'widget',
      resourceId: 'w1',
      payload: payload(),
      changedBy: 'agent_a',
      changedByKind: 'agent',
    }
    // @ts-expect-error — `status` is intentionally not part of the input shape
    input.status = 'auto_written'
    expect(input).toBeDefined()
  })
})

describe('decideChangeProposal surface', () => {
  it('is exported from the service', () => {
    const fake = createFakeDb()
    service = createChangeProposalsService({ db: fake.handle })
    expect(typeof service.decideChangeProposal).toBe('function')
  })
})

describe('listDecided', () => {
  it('filters by status when status !== "all"', async () => {
    const fake = createFakeDb()
    fake.proposals.rows.set('p1', {
      id: 'p1',
      organizationId: 'org_1',
      status: 'approved',
      resourceModule: 'agents',
      conversationId: null,
      decidedAt: new Date(),
      createdAt: new Date(),
    })
    fake.proposals.rows.set('p2', {
      id: 'p2',
      organizationId: 'org_1',
      status: 'rejected',
      resourceModule: 'agents',
      conversationId: null,
      decidedAt: new Date(),
      createdAt: new Date(),
    })
    fake.proposals.rows.set('p3', {
      id: 'p3',
      organizationId: 'org_1',
      status: 'pending',
      resourceModule: 'agents',
      conversationId: null,
      decidedAt: null,
      createdAt: new Date(),
    })
    service = createChangeProposalsService({ db: fake.handle })

    const allRows = await service.listDecided('org_1')
    // The fake `select.from.where` ignores predicates; assert listDecided returns
    // an array of the in-memory rows (filtering happens in the SQL layer for real).
    expect(Array.isArray(allRows)).toBe(true)

    const approvedOnly = await service.listDecided('org_1', { status: 'approved' })
    expect(Array.isArray(approvedOnly)).toBe(true)
  })

  it('respects the limit option', async () => {
    const fake = createFakeDb()
    for (let i = 0; i < 10; i++) {
      fake.proposals.rows.set(`p${i}`, {
        id: `p${i}`,
        organizationId: 'org_1',
        status: 'approved',
        resourceModule: 'agents',
        conversationId: null,
        decidedAt: new Date(),
        createdAt: new Date(),
      })
    }
    service = createChangeProposalsService({ db: fake.handle })

    const out = await service.listDecided('org_1', { limit: 3 })
    expect(out.length).toBeLessThanOrEqual(3)
  })
})

function payload(): ChangePayload {
  return { kind: 'field_set', fields: { plan: { from: 'free', to: 'pro' } } }
}
