/**
 * Unit tests for contacts/service/changes.
 *
 * The materializer reads + writes through the tx handle, so a stub TxLike
 * that records the queries it sees is enough to assert behaviour. The real
 * decide-path coverage (committing through pg + history rows) lives in the
 * E2E suite.
 */

import { describe, expect, it } from 'bun:test'
import type { TxLike } from '@modules/changes/service/proposals'
import type { ChangePayload } from '@vobase/core'

import type { Contact } from '../schema'
import { contactChangeMaterializer } from './changes'

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'c_marcus',
    organizationId: 'org_1',
    displayName: 'Marcus',
    phone: '+6591234567',
    email: 'marcus@x.com',
    profile: '',
    memory: '',
    attributes: { industry: 'tech' },
    segments: [],
    marketingOptOut: false,
    marketingOptOutAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

function makeStubTx(loaded: Contact): { tx: TxLike; lastUpdate: { values: Record<string, unknown> | null } } {
  const lastUpdate: { values: Record<string, unknown> | null } = { values: null }
  const tx = {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                limit() {
                  return Promise.resolve([loaded])
                },
              }
            },
          }
        },
      }
    },
    update() {
      return {
        set(values: Record<string, unknown>) {
          lastUpdate.values = values
          return {
            where() {
              return Promise.resolve(undefined)
            },
          }
        },
      }
    },
  } as unknown as TxLike
  return { tx, lastUpdate }
}

function makeProposal(payload: ChangePayload): Parameters<typeof contactChangeMaterializer>[0] {
  return {
    id: 'p_1',
    organizationId: 'org_1',
    resourceModule: 'contacts',
    resourceType: 'contact',
    resourceId: 'c_marcus',
    payload,
    status: 'auto_written',
    confidence: null,
    rationale: null,
    expectedOutcome: null,
    conversationId: null,
    proposedById: 'agent:a_1',
    proposedByKind: 'agent',
    decidedByUserId: null,
    decidedAt: null,
    decidedNote: null,
    appliedHistoryId: null,
    createdAt: new Date(),
  } as unknown as Parameters<typeof contactChangeMaterializer>[0]
}

describe('contactChangeMaterializer — markdown_patch', () => {
  it('appends to `memory` when field is "memory"', async () => {
    const { tx, lastUpdate } = makeStubTx(makeContact({ memory: '# notes\n- existing' }))
    await contactChangeMaterializer(
      makeProposal({ kind: 'markdown_patch', mode: 'append', field: 'memory', body: '- new line' }),
      tx,
    )
    expect(lastUpdate.values?.memory).toBe('# notes\n- existing\n- new line')
  })

  it("rejects markdown_patch with field='profile' now that profile is the structured surface", async () => {
    const { tx } = makeStubTx(makeContact())
    await expect(
      contactChangeMaterializer(
        makeProposal({ kind: 'markdown_patch', mode: 'append', field: 'profile', body: '- ignored' }),
        tx,
      ),
    ).rejects.toThrow(/markdown_patch field must be 'memory' \(got 'profile'\)/)
  })

  it("rejects unknown markdown_patch fields with the same `must be 'memory'` message", async () => {
    const { tx } = makeStubTx(makeContact())
    await expect(
      contactChangeMaterializer(
        makeProposal({ kind: 'markdown_patch', mode: 'append', field: 'displayName', body: 'oops' }),
        tx,
      ),
    ).rejects.toThrow(/markdown_patch field must be 'memory'/)
  })
})

describe('contactChangeMaterializer — field_set', () => {
  it('writes a top-level scalar', async () => {
    const { tx, lastUpdate } = makeStubTx(makeContact({ phone: '+6591234567' }))
    await contactChangeMaterializer(
      makeProposal({ kind: 'field_set', fields: { phone: { from: '+6591234567', to: '+6598765432' } } }),
      tx,
    )
    expect(lastUpdate.values?.phone).toBe('+6598765432')
  })

  it('merges into attributes.* without overwriting unrelated keys', async () => {
    const { tx, lastUpdate } = makeStubTx(makeContact({ attributes: { industry: 'tech', sizeBand: 'mid' } }))
    await contactChangeMaterializer(
      makeProposal({
        kind: 'field_set',
        fields: { 'attributes.industry': { from: 'tech', to: 'logistics' } },
      }),
      tx,
    )
    expect(lastUpdate.values?.attributes).toEqual({ industry: 'logistics', sizeBand: 'mid' })
  })

  it('rejects an unknown top-level scalar', async () => {
    const { tx } = makeStubTx(makeContact())
    await expect(
      contactChangeMaterializer(makeProposal({ kind: 'field_set', fields: { bogus: { from: null, to: 'x' } } }), tx),
    ).rejects.toThrow(/unsupported field 'bogus'/)
  })

  it('marketingOptOut clears marketingOptOutAt when set to false', async () => {
    const { tx, lastUpdate } = makeStubTx(makeContact({ marketingOptOut: true, marketingOptOutAt: new Date() }))
    await contactChangeMaterializer(
      makeProposal({ kind: 'field_set', fields: { marketingOptOut: { from: true, to: false } } }),
      tx,
    )
    expect(lastUpdate.values?.marketingOptOut).toBe(false)
    expect(lastUpdate.values?.marketingOptOutAt).toBeNull()
  })

  it('segments accepts a single string and wraps it as one-element array', async () => {
    const { tx, lastUpdate } = makeStubTx(makeContact({ segments: [] }))
    await contactChangeMaterializer(
      makeProposal({ kind: 'field_set', fields: { segments: { from: null, to: 'VIP' } } }),
      tx,
    )
    expect(lastUpdate.values?.segments).toEqual(['VIP'])
  })

  it('segments accepts an array and writes it verbatim', async () => {
    const { tx, lastUpdate } = makeStubTx(makeContact({ segments: ['old'] }))
    await contactChangeMaterializer(
      makeProposal({ kind: 'field_set', fields: { segments: { from: ['old'], to: ['VIP', 'wholesale'] } } }),
      tx,
    )
    expect(lastUpdate.values?.segments).toEqual(['VIP', 'wholesale'])
  })

  it('segments throws on non-string/non-array (no more silent no-op)', async () => {
    const { tx } = makeStubTx(makeContact({ segments: ['existing'] }))
    await expect(
      contactChangeMaterializer(
        makeProposal({ kind: 'field_set', fields: { segments: { from: null, to: 42 as unknown as string } } }),
        tx,
      ),
    ).rejects.toThrow(/'segments' must be a string, array of strings, or null/)
  })
})
