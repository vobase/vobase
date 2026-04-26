/**
 * Unit tests for `workspaceTabsReducer`. Pure state machine — no DOM, no
 * persistence (localStorage lives in `usePersistedWorkspaceTabs`).
 */

import { describe, expect, it } from 'bun:test'

import { initialWorkspaceTabsState, type WorkspaceTab, workspaceTabsReducer } from './workspace-tabs'

const SEED: WorkspaceTab[] = [
  { id: 't1', kind: 'document', path: '/agents/a1/AGENTS.md', label: 'AGENTS.md' },
  { id: 't2', kind: 'document', path: '/agents/a1/MEMORY.md', label: 'MEMORY.md' },
  { id: 't3', kind: 'object-list', path: '/contacts/', label: 'Contacts' },
]

describe('workspaceTabsReducer / open', () => {
  it('opens a fresh tab and makes it active', () => {
    const next = workspaceTabsReducer(initialWorkspaceTabsState, {
      type: 'open',
      tab: { id: 't1', kind: 'document', path: '/x.md', label: 'x.md' },
    })
    expect(next.tabs).toHaveLength(1)
    expect(next.tabs[0].id).toBe('t1')
    expect(next.activeTabId).toBe('t1')
  })

  it('focuses an existing tab when opening the same path again', () => {
    const seeded = { tabs: SEED, activeTabId: 't3' }
    const next = workspaceTabsReducer(seeded, {
      type: 'open',
      tab: { id: 'tNEW', kind: 'document', path: '/agents/a1/AGENTS.md', label: 'AGENTS.md' },
    })
    expect(next.tabs).toHaveLength(SEED.length) // no duplicate
    expect(next.activeTabId).toBe('t1')
  })

  it('mints a generated id when none is supplied', () => {
    const next = workspaceTabsReducer(initialWorkspaceTabsState, {
      type: 'open',
      tab: { kind: 'document', path: '/y.md', label: 'y.md' },
    })
    expect(next.tabs[0].id).toBeTruthy()
    expect(next.activeTabId).toBe(next.tabs[0].id)
  })
})

describe('workspaceTabsReducer / close', () => {
  it('closing the active tab activates the previous one', () => {
    const next = workspaceTabsReducer({ tabs: SEED, activeTabId: 't2' }, { type: 'close', tabId: 't2' })
    expect(next.tabs.map((t) => t.id)).toEqual(['t1', 't3'])
    expect(next.activeTabId).toBe('t1')
  })

  it('closing the leftmost active tab activates the new leftmost', () => {
    const next = workspaceTabsReducer({ tabs: SEED, activeTabId: 't1' }, { type: 'close', tabId: 't1' })
    expect(next.tabs.map((t) => t.id)).toEqual(['t2', 't3'])
    expect(next.activeTabId).toBe('t2')
  })

  it('closing a non-active tab leaves the active id alone', () => {
    const next = workspaceTabsReducer({ tabs: SEED, activeTabId: 't1' }, { type: 'close', tabId: 't3' })
    expect(next.tabs.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(next.activeTabId).toBe('t1')
  })

  it('closing the last tab clears active', () => {
    const next = workspaceTabsReducer({ tabs: [SEED[0]], activeTabId: 't1' }, { type: 'close', tabId: 't1' })
    expect(next.tabs).toHaveLength(0)
    expect(next.activeTabId).toBeNull()
  })

  it('closing an unknown tab is a no-op', () => {
    const seeded = { tabs: SEED, activeTabId: 't1' }
    const next = workspaceTabsReducer(seeded, { type: 'close', tabId: 'tBOGUS' })
    expect(next).toBe(seeded)
  })
})

describe('workspaceTabsReducer / closeOthers / closeAll', () => {
  it('closeOthers keeps only the target tab and activates it', () => {
    const next = workspaceTabsReducer({ tabs: SEED, activeTabId: 't1' }, { type: 'closeOthers', tabId: 't2' })
    expect(next.tabs.map((t) => t.id)).toEqual(['t2'])
    expect(next.activeTabId).toBe('t2')
  })

  it('closeOthers on unknown id is a no-op', () => {
    const seeded = { tabs: SEED, activeTabId: 't1' }
    const next = workspaceTabsReducer(seeded, { type: 'closeOthers', tabId: 'tBOGUS' })
    expect(next).toBe(seeded)
  })

  it('closeAll resets to the initial state', () => {
    const next = workspaceTabsReducer({ tabs: SEED, activeTabId: 't2' }, { type: 'closeAll' })
    expect(next.tabs).toHaveLength(0)
    expect(next.activeTabId).toBeNull()
  })
})

describe('workspaceTabsReducer / setActive', () => {
  it('changes the active tab to a known id', () => {
    const next = workspaceTabsReducer({ tabs: SEED, activeTabId: 't1' }, { type: 'setActive', tabId: 't3' })
    expect(next.activeTabId).toBe('t3')
  })

  it('setActive to the same id is identity', () => {
    const seeded = { tabs: SEED, activeTabId: 't2' }
    const next = workspaceTabsReducer(seeded, { type: 'setActive', tabId: 't2' })
    expect(next).toBe(seeded)
  })

  it('setActive to an unknown id is a no-op', () => {
    const seeded = { tabs: SEED, activeTabId: 't1' }
    const next = workspaceTabsReducer(seeded, { type: 'setActive', tabId: 'tBOGUS' })
    expect(next).toBe(seeded)
  })
})

describe('workspaceTabsReducer / reorder', () => {
  it('moves a tab from index to index without touching active', () => {
    const next = workspaceTabsReducer({ tabs: SEED, activeTabId: 't1' }, { type: 'reorder', from: 0, to: 2 })
    expect(next.tabs.map((t) => t.id)).toEqual(['t2', 't3', 't1'])
    expect(next.activeTabId).toBe('t1')
  })

  it('reorder with from === to is identity', () => {
    const seeded = { tabs: SEED, activeTabId: 't1' }
    const next = workspaceTabsReducer(seeded, { type: 'reorder', from: 1, to: 1 })
    expect(next).toBe(seeded)
  })

  it('reorder with out-of-bound indices is a no-op', () => {
    const seeded = { tabs: SEED, activeTabId: 't1' }
    expect(workspaceTabsReducer(seeded, { type: 'reorder', from: -1, to: 0 })).toBe(seeded)
    expect(workspaceTabsReducer(seeded, { type: 'reorder', from: 0, to: 99 })).toBe(seeded)
  })
})

describe('workspaceTabsReducer / rename', () => {
  it('updates a tab label without touching active or order', () => {
    const next = workspaceTabsReducer(
      { tabs: SEED, activeTabId: 't1' },
      { type: 'rename', tabId: 't2', label: 'memory.md (renamed)' },
    )
    expect(next.tabs.map((t) => t.id)).toEqual(['t1', 't2', 't3'])
    expect(next.tabs[1].label).toBe('memory.md (renamed)')
    expect(next.activeTabId).toBe('t1')
  })

  it('rename with an identical label is identity', () => {
    const seeded = { tabs: SEED, activeTabId: 't1' }
    const next = workspaceTabsReducer(seeded, { type: 'rename', tabId: 't1', label: 'AGENTS.md' })
    expect(next).toBe(seeded)
  })

  it('rename of an unknown id is a no-op', () => {
    const seeded = { tabs: SEED, activeTabId: 't1' }
    const next = workspaceTabsReducer(seeded, { type: 'rename', tabId: 'tBOGUS', label: 'x' })
    expect(next).toBe(seeded)
  })
})
