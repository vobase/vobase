/**
 * `useReducer` adapter that persists `workspaceTabsReducer` state to
 * localStorage. Keyed by `(staffId, "workspace")` so two staff sharing a
 * browser don't collide. The reducer itself stays pure — this hook is just
 * the I/O adapter.
 *
 * Hydration is one-shot on mount: if a saved blob is present and parses to
 * a structurally valid state, we replace the initial state with it.
 * Subsequent dispatches schedule a trailing-edge persist after a short
 * debounce so drag-reorder (which fires every animation frame) writes the
 * final order once, not once per frame. Persistence is best-effort —
 * `JSON.parse` failures and missing/corrupt blobs fall back to the initial
 * state.
 */

import { useEffect, useReducer, useRef } from 'react'

import {
  initialWorkspaceTabsState,
  type WorkspaceTabsAction,
  type WorkspaceTabsState,
  workspaceTabsReducer,
} from './workspace-tabs'

const STORAGE_KEY_PREFIX = 'vobase:workspace-tabs:'
const PERSIST_DEBOUNCE_MS = 250

function isValidState(value: unknown): value is WorkspaceTabsState {
  if (!value || typeof value !== 'object') return false
  const v = value as { tabs?: unknown; activeTabId?: unknown }
  if (!Array.isArray(v.tabs)) return false
  if (v.activeTabId !== null && typeof v.activeTabId !== 'string') return false
  return v.tabs.every(
    (t) =>
      typeof t === 'object' &&
      t !== null &&
      typeof (t as { id?: unknown }).id === 'string' &&
      typeof (t as { kind?: unknown }).kind === 'string' &&
      typeof (t as { path?: unknown }).path === 'string' &&
      typeof (t as { label?: unknown }).label === 'string',
  )
}

export function loadPersistedWorkspaceTabs(staffId: string | null): WorkspaceTabsState {
  if (!staffId || typeof window === 'undefined') return initialWorkspaceTabsState
  try {
    const raw = window.localStorage.getItem(`${STORAGE_KEY_PREFIX}${staffId}`)
    if (!raw) return initialWorkspaceTabsState
    const parsed: unknown = JSON.parse(raw)
    return isValidState(parsed) ? parsed : initialWorkspaceTabsState
  } catch {
    return initialWorkspaceTabsState
  }
}

export function persistWorkspaceTabs(staffId: string | null, state: WorkspaceTabsState): void {
  if (!staffId || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(`${STORAGE_KEY_PREFIX}${staffId}`, JSON.stringify(state))
  } catch {
    // Quota or privacy-mode failures are not fatal — the in-memory state is
    // the source of truth; persistence is best-effort.
  }
}

export function usePersistedWorkspaceTabs(
  staffId: string | null,
): [WorkspaceTabsState, (action: WorkspaceTabsAction) => void] {
  const [state, dispatch] = useReducer(workspaceTabsReducer, staffId, loadPersistedWorkspaceTabs)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      persistWorkspaceTabs(staffId, state)
      timerRef.current = null
    }, PERSIST_DEBOUNCE_MS)
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        persistWorkspaceTabs(staffId, state)
        timerRef.current = null
      }
    }
  }, [staffId, state])

  return [state, dispatch]
}
