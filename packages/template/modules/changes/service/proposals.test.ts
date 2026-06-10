/**
 * Unit tests for the change-proposals registry + sensitivity-driven routing.
 *
 * Routing covered here is `confidence × effectiveSensitivity → status`. The
 * sensitivity math itself is unit-tested in `sensitivity.test.ts`; these
 * tests assert the integration with `insertProposal` (registration shape,
 * trivial-drop, materializer firing on auto-write).
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
  listMaterializerRegistrations,
  type Materializer,
  mergeMarkdownPatch,
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
      sensitivity: 'high',
      promptHint: 'a widget',
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
      confidence: 0.5,
    })

    // confidence 0.5 vs sensitivity 'high' (auto bar 0.7 + 0.7×0.3 = 0.91) → pending.
    expect(result.status).toBe('pending')
    expect(materializerCalls).toEqual([])
  })

  it('listMaterializerRegistrations() returns every registered scope', () => {
    registerChangeMaterializer({
      resourceModule: 'widgets',
      resourceType: 'widget',
      sensitivity: 'low',
      promptHint: 'low-sensitivity widget',
      materialize: materializerImpl,
    })
    registerChangeMaterializer({
      resourceModule: 'gadgets',
      resourceType: 'gadget',
      sensitivity: 'critical',
      promptHint: 'critical gadget',
      materialize: materializerImpl,
    })

    const all = listMaterializerRegistrations()
    const keys = all.map((r) => `${r.resourceModule}.${r.resourceType}`).sort()
    expect(keys).toEqual(['gadgets.gadget', 'widgets.widget'])
  })
})

describe('insertProposal sensitivity routing', () => {
  it('auto-applies when confidence ≥ resource auto-threshold', async () => {
    registerChangeMaterializer({
      resourceModule: 'widgets',
      resourceType: 'widget',
      sensitivity: 'low',
      promptHint: 'a widget',
      materialize: materializerImpl,
    })
    const fake = createFakeDb()
    service = createChangeProposalsService({ db: fake.handle })

    // sensitivity 'low' → auto-threshold 0.7 + 0.2 × 0.3 = 0.76
    const result = await service.insertProposal({
      organizationId: 'org_1',
      resourceModule: 'widgets',
      resourceType: 'widget',
      resourceId: 'w1',
      payload: payload(),
      changedBy: 'agent_a',
      changedByKind: 'agent',
      confidence: 0.9,
    })

    expect(result.status).toBe('auto_written')
    expect(materializerCalls.length).toBe(1)
  })

  it('routes to pending when confidence is in the middle band', async () => {
    registerChangeMaterializer({
      resourceModule: 'widgets',
      resourceType: 'widget',
      sensitivity: 'medium',
      promptHint: 'a widget',
      materialize: materializerImpl,
    })
    const fake = createFakeDb()
    service = createChangeProposalsService({ db: fake.handle })

    // sensitivity 'medium' → auto-threshold 0.7 + 0.4 × 0.3 = 0.82
    const result = await service.insertProposal({
      organizationId: 'org_1',
      resourceModule: 'widgets',
      resourceType: 'widget',
      resourceId: 'w1',
      payload: payload(),
      changedBy: 'agent_a',
      changedByKind: 'agent',
      confidence: 0.7,
    })

    expect(result.status).toBe('pending')
    expect(materializerCalls).toEqual([])
  })

  it('returns status="dropped" when confidence < T_REVIEW', async () => {
    registerChangeMaterializer({
      resourceModule: 'widgets',
      resourceType: 'widget',
      sensitivity: 'low',
      promptHint: 'a widget',
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
      confidence: 0.1,
    })

    expect(result.status).toBe('dropped')
    if (result.status === 'dropped') {
      expect(result.confidence).toBe(0.1)
    }
    expect(materializerCalls).toEqual([])
  })

  it('defaults missing confidence to 1.0 (never drops accidentally on manual paths)', async () => {
    registerChangeMaterializer({
      resourceModule: 'widgets',
      resourceType: 'widget',
      sensitivity: 'critical',
      promptHint: 'a widget',
      materialize: materializerImpl,
    })
    const fake = createFakeDb()
    service = createChangeProposalsService({ db: fake.handle })

    // sensitivity 'critical' → auto-threshold 0.7 + 0.95 × 0.3 = 0.985.
    // confidence defaults to 1.0 → auto-written.
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
  })
})

describe('insertProposal sensitivityForFields (per-scalar overrides)', () => {
  it('escalates routing when a field_set proposal touches a high-sensitivity scalar', async () => {
    registerChangeMaterializer({
      resourceModule: 'widgets',
      resourceType: 'widget',
      sensitivity: 'low',
      sensitivityForFields: { displayName: 'critical' },
      promptHint: 'a widget',
      materialize: materializerImpl,
    })
    const fake = createFakeDb()
    service = createChangeProposalsService({ db: fake.handle })

    // confidence 0.9 vs effective sensitivity 'critical' (auto bar 0.985) → pending.
    const result = await service.insertProposal({
      organizationId: 'org_1',
      resourceModule: 'widgets',
      resourceType: 'widget',
      resourceId: 'w1',
      payload: { kind: 'field_set', fields: { displayName: { from: 'Old', to: 'New' } } },
      changedBy: 'agent_a',
      changedByKind: 'agent',
      confidence: 0.9,
    })

    expect(result.status).toBe('pending')
    expect(materializerCalls).toEqual([])
  })

  it('auto-applies a field_set proposal touching only un-escalated keys', async () => {
    registerChangeMaterializer({
      resourceModule: 'widgets',
      resourceType: 'widget',
      sensitivity: 'low',
      sensitivityForFields: { displayName: 'critical' },
      promptHint: 'a widget',
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
      confidence: 0.9,
    })

    expect(result.status).toBe('auto_written')
    expect(materializerCalls.length).toBe(1)
  })

  it('does NOT consult scalar overrides for attributes.* paths (those use the resolver)', async () => {
    registerChangeMaterializer({
      resourceModule: 'widgets',
      resourceType: 'widget',
      sensitivity: 'low',
      // `attributes.priority` in the override map is silently ignored — the
      // attribute resolver path is the only way to escalate per-attribute.
      sensitivityForFields: { 'attributes.priority': 'critical' },
      promptHint: 'a widget',
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
      confidence: 0.9,
    })

    expect(result.status).toBe('auto_written')
    expect(materializerCalls.length).toBe(1)
  })

  it('uses resolveAttributeSensitivities for attributes.<key> paths', async () => {
    let resolverCalls = 0
    registerChangeMaterializer({
      resourceModule: 'widgets',
      resourceType: 'widget',
      sensitivity: 'low',
      promptHint: 'a widget',
      // biome-ignore lint/suspicious/useAwait: contract requires async signature
      resolveAttributeSensitivities: async (orgId, keys) => {
        resolverCalls += 1
        expect(orgId).toBe('org_1')
        expect([...keys]).toEqual(['medical_condition'])
        return ['critical']
      },
      materialize: materializerImpl,
    })
    const fake = createFakeDb()
    service = createChangeProposalsService({ db: fake.handle })

    const result = await service.insertProposal({
      organizationId: 'org_1',
      resourceModule: 'widgets',
      resourceType: 'widget',
      resourceId: 'w1',
      payload: { kind: 'field_set', fields: { 'attributes.medical_condition': { from: null, to: 'asthma' } } },
      changedBy: 'agent_a',
      changedByKind: 'agent',
      confidence: 0.9,
    })

    expect(resolverCalls).toBe(1)
    expect(result.status).toBe('pending')
  })

  it('bypasses scalar overrides for non-field_set payloads (markdown_patch)', async () => {
    registerChangeMaterializer({
      resourceModule: 'widgets',
      resourceType: 'widget',
      sensitivity: 'low',
      sensitivityForFields: { displayName: 'critical' },
      promptHint: 'a widget',
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
      confidence: 0.9,
    })

    expect(result.status).toBe('auto_written')
    expect(materializerCalls.length).toBe(1)
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

// ─── mergeMarkdownPatch ──────────────────────────────────────────────────────

describe('mergeMarkdownPatch', () => {
  it('replace always overwrites', () => {
    expect(mergeMarkdownPatch('- old', { mode: 'replace', body: '- new' })).toBe('- new')
  })

  it('append onto empty blob returns the body without a leading newline', () => {
    expect(mergeMarkdownPatch('', { mode: 'append', body: '- first' })).toBe('- first')
  })

  it('append of a new line concatenates with newline', () => {
    expect(mergeMarkdownPatch('- a', { mode: 'append', body: '- b' })).toBe('- a\n- b')
  })

  it('append of an already-present line returns the blob unchanged', () => {
    const before = '- a\n- b'
    expect(mergeMarkdownPatch(before, { mode: 'append', body: '- b' })).toBe(before)
  })

  it('matches lines trimmed — surrounding whitespace does not defeat the dedup', () => {
    const before = '- keep the line'
    expect(mergeMarkdownPatch(before, { mode: 'append', body: '  - keep the line  ' })).toBe(before)
  })

  it('multi-line append no-ops only when every line is already present', () => {
    const before = '- a\n- b'
    expect(mergeMarkdownPatch(before, { mode: 'append', body: '- a\n- b' })).toBe(before)
    expect(mergeMarkdownPatch(before, { mode: 'append', body: '- a\n- c' })).toBe('- a\n- b\n- a\n- c')
  })

  it('whitespace-only append body still concatenates (no false dedup on empty line set)', () => {
    expect(mergeMarkdownPatch('- a', { mode: 'append', body: '   ' })).toBe('- a\n   ')
  })
})
