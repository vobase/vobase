/**
 * Unit tests for team/service/changes.
 *
 * Mirrors the contacts/service/changes test pattern: a stub TxLike records
 * the values written so each behaviour assertion is local to one materializer
 * invocation. The decide-path commit semantics are exercised in the live
 * smoke tests, not here.
 */

import { describe, expect, it } from 'bun:test'
import type { TxLike } from '@modules/changes/service/proposals'
import type { ChangePayload } from '@vobase/core'

import type { StaffProfile } from '../schema'
import { staffChangeMaterializer } from './changes'

function makeStaff(overrides: Partial<StaffProfile> = {}): StaffProfile {
  return {
    userId: 'u_alice',
    organizationId: 'org_1',
    displayName: 'Alice',
    title: 'CSM',
    sectors: ['logistics'],
    expertise: ['onboarding'],
    languages: ['en'],
    capacity: 10,
    availability: 'active',
    attributes: { pager: 'pd-alice' },
    profile: '',
    memory: '',
    lastSeenAt: null,
    whatsappPhoneE164: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

function makeStubTx(loaded: StaffProfile): { tx: TxLike; lastUpdate: { values: Record<string, unknown> | null } } {
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

function makeProposal(payload: ChangePayload): Parameters<typeof staffChangeMaterializer>[0] {
  return {
    id: 'p_1',
    organizationId: 'org_1',
    resourceModule: 'team',
    resourceType: 'staff',
    resourceId: 'u_alice',
    payload,
    status: 'pending',
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
  } as unknown as Parameters<typeof staffChangeMaterializer>[0]
}

describe('staffChangeMaterializer — field_set', () => {
  it('writes a top-level scalar', async () => {
    const { tx, lastUpdate } = makeStubTx(makeStaff())
    await staffChangeMaterializer(
      makeProposal({ kind: 'field_set', fields: { title: { from: 'CSM', to: 'Senior CSM' } } }),
      tx,
    )
    expect(lastUpdate.values?.title).toBe('Senior CSM')
  })

  it('writes the availability enum', async () => {
    const { tx, lastUpdate } = makeStubTx(makeStaff())
    await staffChangeMaterializer(
      makeProposal({ kind: 'field_set', fields: { availability: { from: 'active', to: 'busy' } } }),
      tx,
    )
    expect(lastUpdate.values?.availability).toBe('busy')
  })

  it('rejects an out-of-range availability value', async () => {
    const { tx } = makeStubTx(makeStaff())
    await expect(
      staffChangeMaterializer(
        makeProposal({ kind: 'field_set', fields: { availability: { from: 'active', to: 'on-call' } } }),
        tx,
      ),
    ).rejects.toThrow(/'availability' must be one of/)
  })

  it('rejects email — auth-side column, not a v1 staff write target', async () => {
    const { tx } = makeStubTx(makeStaff())
    await expect(
      staffChangeMaterializer(makeProposal({ kind: 'field_set', fields: { email: { from: null, to: 'a@b.c' } } }), tx),
    ).rejects.toThrow(/unsupported field 'email'/)
  })

  it('writes string-array fields without dropping items', async () => {
    const { tx, lastUpdate } = makeStubTx(makeStaff())
    await staffChangeMaterializer(
      makeProposal({
        kind: 'field_set',
        fields: { sectors: { from: ['logistics'], to: ['logistics', 'manufacturing'] } },
      }),
      tx,
    )
    expect(lastUpdate.values?.sectors).toEqual(['logistics', 'manufacturing'])
  })

  it('rejects a non-array value for sectors', async () => {
    const { tx } = makeStubTx(makeStaff())
    await expect(
      staffChangeMaterializer(
        makeProposal({ kind: 'field_set', fields: { sectors: { from: [], to: 'logistics' } } }),
        tx,
      ),
    ).rejects.toThrow(/'sectors' must be an array of strings/)
  })

  it('merges into attributes.* without overwriting unrelated keys', async () => {
    const { tx, lastUpdate } = makeStubTx(makeStaff({ attributes: { pager: 'pd-alice', region: 'sg' } }))
    await staffChangeMaterializer(
      makeProposal({
        kind: 'field_set',
        fields: { 'attributes.region': { from: 'sg', to: 'apac' } },
      }),
      tx,
    )
    expect(lastUpdate.values?.attributes).toEqual({ pager: 'pd-alice', region: 'apac' })
  })

  it('rejects markdown_patch payloads — staff is field_set-only', async () => {
    const { tx } = makeStubTx(makeStaff())
    await expect(
      staffChangeMaterializer(
        makeProposal({ kind: 'markdown_patch', mode: 'append', field: 'memory', body: 'note' }),
        tx,
      ),
    ).rejects.toThrow(/only 'field_set' payloads are supported/)
  })

  it('rejects capacity that is not a finite number', async () => {
    const { tx } = makeStubTx(makeStaff())
    await expect(
      staffChangeMaterializer(
        makeProposal({ kind: 'field_set', fields: { capacity: { from: 10, to: 'a-bunch' } } }),
        tx,
      ),
    ).rejects.toThrow(/'capacity' must be a finite number/)
  })
})
