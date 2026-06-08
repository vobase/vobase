import { describe, expect, it } from 'bun:test'

import { type HistorySync, resolveSyncToast } from './history-sync-toast'

const mk = (status: HistorySync['status'], progress = 0): HistorySync => ({
  instanceId: 'i1',
  displayName: 'WhatsApp',
  status,
  progress,
})

describe('resolveSyncToast', () => {
  it('shows the importing toast for a fresh in-progress sync', () => {
    expect(resolveSyncToast(undefined, mk('importing', 30))).toBe('importing')
  })

  it('re-renders the importing toast as progress advances', () => {
    expect(resolveSyncToast('importing:30', mk('importing', 60))).toBe('importing')
  })

  it('skips a poll where nothing changed', () => {
    expect(resolveSyncToast('importing:60', mk('importing', 60))).toBe('none')
  })

  it('celebrates completion only after watching the import', () => {
    expect(resolveSyncToast('importing:90', mk('imported', 100))).toBe('done')
  })

  it('stays silent for history already imported when the page loads', () => {
    expect(resolveSyncToast(undefined, mk('imported', 100))).toBe('none')
  })

  it('surfaces a decline we watched, but not a stale one on load', () => {
    expect(resolveSyncToast('importing:0', mk('declined', 0))).toBe('declined')
    expect(resolveSyncToast(undefined, mk('declined', 0))).toBe('none')
  })
})
