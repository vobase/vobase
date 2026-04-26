/**
 * Workspace tab strip reducer. Pure state machine over a list of open tabs +
 * the active tab id. The Workspace surface layout (`src/shell/workspace-layout.tsx`,
 * §9.1) consumes this through `useReducer`; tree clicks dispatch `open`,
 * close-button clicks dispatch `close`, and the chrome-style tab strip
 * dispatches `setActive` and `reorder` on drag.
 *
 * Invariants:
 *   - Opening a tab whose `path` already matches an existing tab focuses
 *     the existing one instead of duplicating.
 *   - Closing the active tab activates the tab to its left (or right if it
 *     was leftmost). Closing a non-active tab leaves `activeTabId` alone.
 *   - Reordering never changes the active tab.
 *   - `setActive` to an unknown id is a no-op.
 *   - `closeAll` resets `activeTabId` to null.
 */

import { parseOperatorChatPath, parseOperatorSchedulePath } from '@modules/agents/service/synthetic-ids'
import { nanoid } from 'nanoid'

/** Cap on open tabs to keep persisted state + drag-reorder bookkeeping bounded. */
export const MAX_WORKSPACE_TABS = 30

/**
 * Tab kinds map to render strategies in `workspace-layout.tsx`. Adding a new
 * kind is a UI concern (pick a renderer); the reducer doesn't care which
 * renderer the kind drives.
 */
export type TabKind = 'object-list' | 'entry' | 'document' | 'chat' | 'report' | 'schedule' | 'settings'

export interface WorkspaceTab {
  /** Stable id assigned at open-time. */
  id: string
  kind: TabKind
  /**
   * Logical address used for dedupe — two opens with the same path collapse
   * to the same tab. Use the workspace virtual-filesystem path for
   * object-list / entry / document; use `chat:<threadId>`,
   * `schedule:<scheduleId>`, etc. for non-FS kinds.
   */
  path: string
  label: string
  /** Optional kind-specific bag the renderer reads. */
  meta?: Record<string, unknown>
}

export interface WorkspaceTabsState {
  tabs: WorkspaceTab[]
  activeTabId: string | null
}

export type WorkspaceTabsAction =
  | { type: 'open'; tab: Omit<WorkspaceTab, 'id'> & { id?: string } }
  | { type: 'close'; tabId: string }
  | { type: 'closeOthers'; tabId: string }
  | { type: 'closeAll' }
  | { type: 'setActive'; tabId: string }
  | { type: 'reorder'; from: number; to: number }
  | { type: 'rename'; tabId: string; label: string }

export const initialWorkspaceTabsState: WorkspaceTabsState = {
  tabs: [],
  activeTabId: null,
}

export function workspaceTabsReducer(state: WorkspaceTabsState, action: WorkspaceTabsAction): WorkspaceTabsState {
  switch (action.type) {
    case 'open': {
      const existing = state.tabs.find((t) => t.path === action.tab.path)
      if (existing) {
        // Dedupe by path — already open, just focus.
        return state.activeTabId === existing.id ? state : { ...state, activeTabId: existing.id }
      }
      const tab: WorkspaceTab = {
        id: action.tab.id ?? nanoid(8),
        kind: action.tab.kind,
        path: action.tab.path,
        label: action.tab.label,
        meta: action.tab.meta,
      }
      // Bound the tab list — drop the oldest non-active tab when full so the
      // active tab is never evicted out from under the staff.
      let baseTabs = state.tabs
      if (baseTabs.length >= MAX_WORKSPACE_TABS) {
        const evictIdx = baseTabs.findIndex((t) => t.id !== state.activeTabId)
        if (evictIdx !== -1) baseTabs = [...baseTabs.slice(0, evictIdx), ...baseTabs.slice(evictIdx + 1)]
      }
      return { tabs: [...baseTabs, tab], activeTabId: tab.id }
    }

    case 'close': {
      const idx = state.tabs.findIndex((t) => t.id === action.tabId)
      if (idx === -1) return state
      const nextTabs = [...state.tabs.slice(0, idx), ...state.tabs.slice(idx + 1)]
      let nextActive = state.activeTabId
      if (state.activeTabId === action.tabId) {
        // Active just closed — pick the previous (or the new leftmost).
        if (nextTabs.length === 0) nextActive = null
        else if (idx === 0) nextActive = nextTabs[0].id
        else nextActive = nextTabs[idx - 1].id
      }
      return { tabs: nextTabs, activeTabId: nextActive }
    }

    case 'closeOthers': {
      const target = state.tabs.find((t) => t.id === action.tabId)
      if (!target) return state
      return { tabs: [target], activeTabId: target.id }
    }

    case 'closeAll':
      return initialWorkspaceTabsState

    case 'setActive': {
      const exists = state.tabs.some((t) => t.id === action.tabId)
      if (!exists) return state
      return state.activeTabId === action.tabId ? state : { ...state, activeTabId: action.tabId }
    }

    case 'reorder': {
      const { from, to } = action
      if (from === to || from < 0 || from >= state.tabs.length || to < 0 || to >= state.tabs.length) {
        return state
      }
      const next = [...state.tabs]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return { ...state, tabs: next }
    }

    case 'rename': {
      const idx = state.tabs.findIndex((t) => t.id === action.tabId)
      if (idx === -1) return state
      const current = state.tabs[idx]
      if (current.label === action.label) return state
      const nextTabs = [...state.tabs]
      nextTabs[idx] = { ...current, label: action.label }
      return { ...state, tabs: nextTabs }
    }

    default: {
      const exhaustive: never = action
      throw new Error(`workspace-tabs: unknown action ${String(exhaustive)}`)
    }
  }
}

/**
 * Path → tab metadata. Each entry owns the kind's identity end-to-end:
 * `match(path)` returns true when the path belongs to the kind, `label(path)`
 * formats it for the strip. Producers (workspace tree) and consumers
 * (workspace layout) read from this one table so the two can never drift.
 *
 * Order matters — the resolver runs entries top-to-bottom and returns the
 * first match. `entry` is the catch-all and must stay last.
 */
interface TabKindDescriptor {
  kind: TabKind
  match: (path: string) => boolean
  label: (path: string) => string
}

const lastSegment = (path: string): string => path.split('/').filter(Boolean).slice(-1)[0] ?? path

const TAB_KIND_TABLE: readonly TabKindDescriptor[] = [
  {
    kind: 'chat',
    match: (p) => parseOperatorChatPath(p) !== null,
    label: (p) => `Chat: ${parseOperatorChatPath(p) ?? p}`,
  },
  {
    kind: 'schedule',
    match: (p) => parseOperatorSchedulePath(p) !== null,
    label: (p) => `Schedule: ${parseOperatorSchedulePath(p) ?? p}`,
  },
  {
    kind: 'document',
    match: (p) => p === '/INDEX.md' || p.endsWith('.md') || p.endsWith('.view.yaml'),
    label: lastSegment,
  },
  {
    kind: 'object-list',
    match: (p) => p === '/contacts/' || p === '/agents/' || p === '/drive/',
    label: lastSegment,
  },
  { kind: 'entry', match: () => true, label: lastSegment },
]

export function resolveTabForPath(path: string): { kind: TabKind; label: string } {
  // The trailing `entry` row matches everything, so this is total.
  const entry = TAB_KIND_TABLE.find((d) => d.match(path)) as TabKindDescriptor
  return { kind: entry.kind, label: entry.label(path) }
}
