/**
 * Tests for `loadPersistedWorkspaceTabs` + `persistWorkspaceTabs` — the pure
 * functions powering the `usePersistedWorkspaceTabs` hook. The hook itself
 * is a thin `useReducer` + `useEffect` adapter; testing the pure functions
 * covers all branching logic without booting React in the test runner.
 *
 * These tests rely on bun's native `localStorage` polyfill (Bun >=1.0).
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import { loadPersistedWorkspaceTabs, persistWorkspaceTabs } from './use-persisted-workspace-tabs'
import type { WorkspaceTabsState } from './workspace-tabs'

const STORAGE_KEY_PREFIX = 'vobase:workspace-tabs:'

// Minimal in-memory localStorage shim for the Bun test runner.
const memoryStore: Record<string, string> = {}
const fakeStorage: Storage = {
  get length() {
    return Object.keys(memoryStore).length
  },
  clear() {
    for (const k of Object.keys(memoryStore)) delete memoryStore[k]
  },
  getItem(key) {
    return Object.hasOwn(memoryStore, key) ? memoryStore[key] : null
  },
  key(index) {
    return Object.keys(memoryStore)[index] ?? null
  },
  removeItem(key) {
    delete memoryStore[key]
  },
  setItem(key, value) {
    memoryStore[key] = String(value)
  },
}

beforeEach(() => {
  fakeStorage.clear()
  ;(globalThis as { window?: { localStorage: Storage } }).window = { localStorage: fakeStorage }
})

afterEach(() => {
  fakeStorage.clear()
  delete (globalThis as { window?: unknown }).window
})

describe('loadPersistedWorkspaceTabs', () => {
  it('returns initial state when no blob is stored', () => {
    expect(loadPersistedWorkspaceTabs('u1')).toEqual({ tabs: [], activeTabId: null })
  })

  it('hydrates a valid stored blob', () => {
    fakeStorage.setItem(
      `${STORAGE_KEY_PREFIX}u1`,
      JSON.stringify({
        tabs: [{ id: 't1', kind: 'document', path: '/INDEX.md', label: 'INDEX.md' }],
        activeTabId: 't1',
      }),
    )
    const state = loadPersistedWorkspaceTabs('u1')
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0].path).toBe('/INDEX.md')
    expect(state.activeTabId).toBe('t1')
  })

  it('falls back to initial when the stored blob is structurally invalid', () => {
    fakeStorage.setItem(`${STORAGE_KEY_PREFIX}u1`, '{"tabs":"not-an-array"}')
    expect(loadPersistedWorkspaceTabs('u1').tabs).toEqual([])
  })

  it('falls back to initial when the stored blob is not parseable JSON', () => {
    fakeStorage.setItem(`${STORAGE_KEY_PREFIX}u1`, '{not json')
    expect(loadPersistedWorkspaceTabs('u1').tabs).toEqual([])
  })

  it('returns initial state when staffId is null', () => {
    fakeStorage.setItem(`${STORAGE_KEY_PREFIX}null`, JSON.stringify({ tabs: [], activeTabId: null }))
    expect(loadPersistedWorkspaceTabs(null)).toEqual({ tabs: [], activeTabId: null })
  })

  it('keys per staff — alice and bob do not collide', () => {
    fakeStorage.setItem(
      `${STORAGE_KEY_PREFIX}alice`,
      JSON.stringify({
        tabs: [{ id: 'a', kind: 'document', path: '/alice', label: 'A' }],
        activeTabId: 'a',
      }),
    )
    expect(loadPersistedWorkspaceTabs('alice').tabs[0].path).toBe('/alice')
    expect(loadPersistedWorkspaceTabs('bob').tabs).toEqual([])
  })
})

describe('persistWorkspaceTabs', () => {
  const STATE: WorkspaceTabsState = {
    tabs: [{ id: 't1', kind: 'document', path: '/x', label: 'x' }],
    activeTabId: 't1',
  }

  it('writes the JSON blob under the staff key', () => {
    persistWorkspaceTabs('u1', STATE)
    const raw = fakeStorage.getItem(`${STORAGE_KEY_PREFIX}u1`)
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw ?? 'null')
    expect(parsed.activeTabId).toBe('t1')
    expect(parsed.tabs).toHaveLength(1)
  })

  it('skips persistence when staffId is null', () => {
    persistWorkspaceTabs(null, STATE)
    expect(fakeStorage.length).toBe(0)
  })

  it('round-trips load → persist → load to identity', () => {
    persistWorkspaceTabs('u1', STATE)
    const loaded = loadPersistedWorkspaceTabs('u1')
    expect(loaded).toEqual(STATE)
  })

  it('tolerates storage write failures without throwing', () => {
    const original = fakeStorage.setItem.bind(fakeStorage)
    const setItemMock = mock(() => {
      throw new Error('quota exceeded')
    })
    fakeStorage.setItem = setItemMock as unknown as typeof fakeStorage.setItem
    try {
      expect(() => persistWorkspaceTabs('u1', STATE)).not.toThrow()
      expect(setItemMock).toHaveBeenCalled()
    } finally {
      fakeStorage.setItem = original
    }
  })
})
