/**
 * Unit tests for `planCoexistenceSyncs` — the once-only guard that decides which
 * SMB App Data syncs to fire after a coexistence number is onboarded. Pure
 * decision logic: no I/O, so it is exercised directly against config shapes.
 */
import { describe, expect, it } from 'bun:test'

import {
  clearCoexistenceSyncGuards,
  planCoexistenceSyncs,
  type SmbSyncType,
  triggerCoexistenceSyncs,
} from './coexistence-sync'
import type { WhatsappInstanceConfig } from './instance-config'

describe('planCoexistenceSyncs', () => {
  it('fires both history and contacts for a fresh coexistence instance', () => {
    expect(planCoexistenceSyncs({ coexistence: true })).toEqual(['history', 'smb_app_state_sync'])
  })

  it('skips a sync that was already requested (once-only guard)', () => {
    expect(
      planCoexistenceSyncs({
        coexistence: true,
        coexistenceHistory: { historyRequestedAt: '2026-06-02T10:00:00.000Z' },
      }),
    ).toEqual(['smb_app_state_sync'])
  })

  it('fires nothing once both syncs have been requested', () => {
    expect(
      planCoexistenceSyncs({
        coexistence: true,
        coexistenceHistory: {
          historyRequestedAt: '2026-06-02T10:00:00.000Z',
          contactsRequestedAt: '2026-06-02T10:00:00.000Z',
        },
      }),
    ).toEqual([])
  })

  it('fires nothing for a non-coexistence (Cloud API) instance', () => {
    expect(planCoexistenceSyncs({ coexistence: false })).toEqual([])
  })
})

describe('clearCoexistenceSyncGuards', () => {
  it('clears the history guard + surfaced status, leaving contacts intact', () => {
    const next = clearCoexistenceSyncGuards(
      {
        historyRequestedAt: '2026-06-05T04:42:50.000Z',
        contactsRequestedAt: '2026-06-05T04:42:52.000Z',
        status: 'imported',
        progress: 100,
        historyResolved: true,
      },
      ['history'],
    )
    expect(next.historyRequestedAt).toBeUndefined()
    expect(next.status).toBeUndefined()
    expect(next.progress).toBeUndefined()
    expect(next.historyResolved).toBeUndefined()
    expect(next.contactsRequestedAt).toBe('2026-06-05T04:42:52.000Z')
  })

  it('re-enables a history re-fire through planCoexistenceSyncs (the prod recovery path)', () => {
    // The bug: Meta accepted the history request (guard set) but never delivered,
    // so plan() would skip it forever. After clearing, history re-plans.
    const coexistenceHistory = clearCoexistenceSyncGuards(
      { historyRequestedAt: '2026-06-05T04:42:50.000Z', contactsRequestedAt: '2026-06-05T04:42:52.000Z' },
      ['history'],
    )
    expect(planCoexistenceSyncs({ coexistence: true, coexistenceHistory })).toEqual(['history'])
  })

  it('clears only the contacts guard when asked', () => {
    const next = clearCoexistenceSyncGuards(
      { historyRequestedAt: '2026-06-05T04:42:50.000Z', contactsRequestedAt: '2026-06-05T04:42:52.000Z' },
      ['smb_app_state_sync'],
    )
    expect(next.contactsRequestedAt).toBeUndefined()
    expect(next.historyRequestedAt).toBe('2026-06-05T04:42:50.000Z')
  })

  it('is a no-op safe on undefined / empty resync', () => {
    expect(clearCoexistenceSyncGuards(undefined, [])).toEqual({})
    expect(clearCoexistenceSyncGuards({ historyRequestedAt: 'x' }, [])).toEqual({ historyRequestedAt: 'x' })
  })
})

describe('triggerCoexistenceSyncs', () => {
  const baseConfig: WhatsappInstanceConfig = {
    mode: 'self',
    coexistence: true,
    wabaId: 'waba-1',
    phoneNumberId: 'PNID-1',
    apiVersion: 'v22.0',
  }
  const fixedNow = () => new Date('2026-06-02T12:00:00.000Z')

  it('fires both syncs and records both request timestamps for a fresh coexistence instance', async () => {
    const calls: Array<{ phoneNumberId: string; syncType: SmbSyncType }> = []
    const sync = (phoneNumberId: string, syncType: SmbSyncType): Promise<{ requestId: string }> => {
      calls.push({ phoneNumberId, syncType })
      return Promise.resolve({ requestId: 'req' })
    }

    const outcome = await triggerCoexistenceSyncs(baseConfig, 'token-abc', { sync, now: fixedNow })

    expect(calls).toEqual([
      { phoneNumberId: 'PNID-1', syncType: 'history' },
      { phoneNumberId: 'PNID-1', syncType: 'smb_app_state_sync' },
    ])
    expect(outcome.coexistenceHistory.historyRequestedAt).toBe('2026-06-02T12:00:00.000Z')
    expect(outcome.coexistenceHistory.contactsRequestedAt).toBe('2026-06-02T12:00:00.000Z')
    expect(outcome.failures).toEqual([])
  })

  it('isolates a failing sync: records the failure, leaves its timestamp unset, still fires the other', async () => {
    const sync = (_phoneNumberId: string, syncType: SmbSyncType): Promise<{ requestId: string }> => {
      if (syncType === 'history') return Promise.reject(new Error('boom'))
      return Promise.resolve({ requestId: 'req' })
    }

    const outcome = await triggerCoexistenceSyncs(baseConfig, 'token-abc', { sync, now: fixedNow })

    expect(outcome.failures).toEqual([{ syncType: 'history', error: 'boom' }])
    expect(outcome.coexistenceHistory.historyRequestedAt).toBeUndefined()
    expect(outcome.coexistenceHistory.contactsRequestedAt).toBe('2026-06-02T12:00:00.000Z')
  })

  it('skips an already-requested sync and preserves its existing timestamp (no double-fire on retry)', async () => {
    const calls: SmbSyncType[] = []
    const sync = (_phoneNumberId: string, syncType: SmbSyncType): Promise<{ requestId: string }> => {
      calls.push(syncType)
      return Promise.resolve({ requestId: 'req' })
    }
    const config: WhatsappInstanceConfig = {
      ...baseConfig,
      coexistenceHistory: { historyRequestedAt: '2026-01-01T00:00:00.000Z' },
    }

    const outcome = await triggerCoexistenceSyncs(config, 'token-abc', { sync, now: fixedNow })

    expect(calls).toEqual(['smb_app_state_sync'])
    expect(outcome.coexistenceHistory.historyRequestedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(outcome.coexistenceHistory.contactsRequestedAt).toBe('2026-06-02T12:00:00.000Z')
  })

  it('does nothing for a non-coexistence (Cloud API) instance', async () => {
    const calls: SmbSyncType[] = []
    const sync = (_phoneNumberId: string, syncType: SmbSyncType): Promise<{ requestId: string }> => {
      calls.push(syncType)
      return Promise.resolve({ requestId: 'req' })
    }

    const outcome = await triggerCoexistenceSyncs({ ...baseConfig, coexistence: false }, 'token-abc', {
      sync,
      now: fixedNow,
    })

    expect(calls).toEqual([])
    expect(outcome.failures).toEqual([])
  })
})
