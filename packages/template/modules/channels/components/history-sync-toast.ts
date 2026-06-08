/**
 * Pure transition logic for the WhatsApp history-import toast. Kept free of
 * React / sonner so the "when do we surface a toast" decision is unit-testable.
 */

export interface HistorySync {
  instanceId: string
  displayName: string | null
  status: 'importing' | 'imported' | 'declined'
  progress: number
}

export type SyncToastAction = 'importing' | 'done' | 'declined' | 'none'

/** Collapses a sync to the state we'd render, so unchanged polls don't re-toast. */
export function syncSignature(sync: HistorySync): string {
  return `${sync.status}:${Math.round(sync.progress)}`
}

/**
 * Decide how to surface a sync, given the last signature we acted on for it.
 * Completion / decline only fire for syncs we actually watched importing this
 * session — so a page load with already-imported history stays silent instead
 * of celebrating an old import.
 */
export function resolveSyncToast(prevSig: string | undefined, sync: HistorySync): SyncToastAction {
  if (prevSig === syncSignature(sync)) return 'none'
  if (sync.status === 'importing') return 'importing'

  const watchedImport = prevSig?.startsWith('importing') ?? false
  if (sync.status === 'imported') return watchedImport ? 'done' : 'none'
  if (sync.status === 'declined') return watchedImport ? 'declined' : 'none'
  return 'none'
}
