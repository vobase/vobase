/**
 * Frontend hooks for the `/automations` dashboard.
 *
 * Four endpoints behind four hooks; each TanStack Query key's first element
 * matches the `pg_notify` `table` column so `use-realtime-invalidation`'s
 * generic fallback fans out cleanly when the dashboard is open and a service
 * mutates the underlying table.
 *
 * Mutations go through the system CLI verbs (admin-tier HTTP dispatch);
 * the system module exposes a small RPC client wrapper here so the page
 * doesn't construct raw fetch calls.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { systemClient } from '@/lib/api-client'
import type { ActiveWakeRow, AutomationRow, BannerData, RunRow } from '../activity-types'

export type { ActiveWakeRow, AutomationRow, BannerData, RunRow }

export function useActivityBanner() {
  return useQuery({
    queryKey: ['system', 'activity', 'banner'],
    queryFn: async (): Promise<BannerData> => {
      const r = await systemClient.activity.banner.$get()
      if (!r.ok) throw new Error(`system.activity.banner failed: ${r.status}`)
      return (await r.json()) as BannerData
    },
    // Cost rollup is a 60s windowed aggregate — poll once per minute and on
    // tab refocus per the slice acceptance criteria.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
}

export function useActivityAutomations() {
  return useQuery({
    queryKey: ['system', 'activity', 'automations'],
    queryFn: async (): Promise<AutomationRow[]> => {
      const r = await systemClient.activity.automations.$get()
      if (!r.ok) throw new Error(`system.activity.automations failed: ${r.status}`)
      const json = (await r.json()) as { rules: AutomationRow[] }
      return json.rules
    },
  })
}

export function useActivityRuns() {
  return useQuery({
    queryKey: ['system', 'activity', 'runs'],
    queryFn: async (): Promise<RunRow[]> => {
      const r = await systemClient.activity.runs.$get()
      if (!r.ok) throw new Error(`system.activity.runs failed: ${r.status}`)
      const json = (await r.json()) as { runs: RunRow[] }
      return json.runs
    },
  })
}

export function useActivityActiveWakes() {
  return useQuery({
    queryKey: ['system', 'activity', 'active-wakes'],
    queryFn: async (): Promise<ActiveWakeRow[]> => {
      const r = await systemClient.activity['active-wakes'].$get()
      if (!r.ok) throw new Error(`system.activity.active-wakes failed: ${r.status}`)
      const json = (await r.json()) as { wakes: ActiveWakeRow[] }
      return json.wakes
    },
  })
}

// ─── Mutations — dispatch CLI verbs over HTTP-RPC ─────────────────────────

interface VerbResult<T> {
  ok: boolean
  data?: T
  error?: string
  errorCode?: string
}

async function dispatchVerb<T>(path: string, body: Record<string, unknown>): Promise<T> {
  // biome-ignore lint/plugin/no-raw-fetch: dynamic CLI dispatch route (/api/cli/<verb-name>) is not statically typeable — verbs are registered at boot from any module, so the typed Hono RPC client can't see them. The route lives behind requireSession+requireOrganization+requireRole middleware (see runtime/bootstrap.ts).
  const r = await fetch(`/api/cli/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  })
  if (!r.ok) throw new Error(`verb dispatch ${path} failed: ${r.status}`)
  const json = (await r.json()) as VerbResult<T>
  if (!json.ok) throw new Error(json.error ?? 'verb failed')
  return json.data as T
}

export function usePauseAutomation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ruleId, reason }: { ruleId: string; reason: string }) =>
      dispatchVerb('automations:pause', { ruleId, reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['system', 'activity', 'automations'] })
      qc.invalidateQueries({ queryKey: ['system', 'activity', 'banner'] })
    },
  })
}

export function useResumeAutomation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ruleId }: { ruleId: string }) => dispatchVerb('automations:resume', { ruleId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['system', 'activity', 'automations'] })
      qc.invalidateQueries({ queryKey: ['system', 'activity', 'banner'] })
    },
  })
}

export function useSetBudget() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ capUsd }: { capUsd: number | null }) =>
      dispatchVerb('budget:set', capUsd === null ? { clear: true } : { capUsd }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['system', 'activity', 'banner'] })
    },
  })
}
