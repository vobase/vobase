/**
 * Coexistence SMB App Data sync planning — the once-only guard that decides
 * which syncs to fire after a coexistence number is onboarded. Pure decision
 * logic, kept separate from the I/O so it is unit-testable: the setup job calls
 * `planCoexistenceSyncs(config)` then fires `syncSmbAppData` for each planned
 * type and records the request timestamp (see jobs/setup.ts).
 */
import type { WhatsappInstanceConfig } from './instance-config'
import { type MetaOAuthConfig, syncSmbAppData } from './meta-oauth'

export type SmbSyncType = 'history' | 'smb_app_state_sync'

export function planCoexistenceSyncs(
  config: Pick<WhatsappInstanceConfig, 'coexistence' | 'coexistenceHistory'>,
): SmbSyncType[] {
  if (!config.coexistence) return []
  const requested = config.coexistenceHistory ?? {}
  const plan: SmbSyncType[] = []
  if (!requested.historyRequestedAt) plan.push('history')
  if (!requested.contactsRequestedAt) plan.push('smb_app_state_sync')
  return plan
}

type CoexistenceHistoryState = NonNullable<WhatsappInstanceConfig['coexistenceHistory']>

/**
 * Clear the once-only request guard for the given SMB App Data sync types,
 * returning the next `coexistenceHistory` state. The guard (`historyRequestedAt`
 * / `contactsRequestedAt`) makes `planCoexistenceSyncs` skip an already-requested
 * sync — correct for the happy path, but a dead end when Meta accepts the request
 * and never delivers (e.g. the business approves the on-phone "sync older chats"
 * prompt only after the first `history` request). Clearing the guard lets the
 * setup job re-fire that one sync. For `history` we also drop the surfaced
 * import status so the drain re-derives it from the fresh burst. Pure — the
 * caller persists the result on the instance config.
 */
export function clearCoexistenceSyncGuards(
  current: CoexistenceHistoryState | undefined,
  resyncTypes: readonly SmbSyncType[],
): CoexistenceHistoryState {
  const next: CoexistenceHistoryState = { ...(current ?? {}) }
  if (resyncTypes.includes('history')) {
    next.historyRequestedAt = undefined
    next.status = undefined
    next.progress = undefined
    next.historyResolved = undefined
  }
  if (resyncTypes.includes('smb_app_state_sync')) {
    next.contactsRequestedAt = undefined
  }
  return next
}

export interface CoexistenceSyncOutcome {
  /** Updated guard state to persist on the instance config. */
  coexistenceHistory: NonNullable<WhatsappInstanceConfig['coexistenceHistory']>
  /** Per-sync failures — non-fatal; the sync's timestamp is left unset so the retry hatch can re-fire. */
  failures: Array<{ syncType: SmbSyncType; error: string }>
}

/**
 * Fire the post-onboarding SMB App Data syncs for a coexistence instance and
 * return the updated guard state to persist. A request timestamp is recorded
 * only on success, so a failed sync stays re-fireable; a failure never aborts
 * the other sync or the surrounding setup job (it is collected, not thrown).
 */
export async function triggerCoexistenceSyncs(
  config: WhatsappInstanceConfig,
  accessToken: string,
  deps: { sync?: typeof syncSmbAppData; now?: () => Date } = {},
): Promise<CoexistenceSyncOutcome> {
  const sync = deps.sync ?? syncSmbAppData
  const now = deps.now ?? (() => new Date())
  const oauthConfig: MetaOAuthConfig = {
    appId: config.appId ?? '',
    appSecret: config.appSecret ?? '',
    apiVersion: config.apiVersion ?? 'v22.0',
  }
  const coexistenceHistory = { ...(config.coexistenceHistory ?? {}) }
  const failures: CoexistenceSyncOutcome['failures'] = []

  for (const syncType of planCoexistenceSyncs(config)) {
    try {
      await sync(config.phoneNumberId, syncType, accessToken, oauthConfig)
      const requestedAt = now().toISOString()
      if (syncType === 'history') coexistenceHistory.historyRequestedAt = requestedAt
      else coexistenceHistory.contactsRequestedAt = requestedAt
    } catch (err) {
      failures.push({ syncType, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return { coexistenceHistory, failures }
}
