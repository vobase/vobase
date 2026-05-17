/**
 * Shared activity-dashboard response shapes.
 *
 * Lives outside `handlers/` and `hooks/` so both the backend route + the
 * frontend hook reference the same types without crossing the
 * frontend/backend bundle boundary (the hook can't import from
 * `handlers/`; the backend can't import from `hooks/`).
 *
 * Mirrors the JSON the handlers emit on each endpoint.
 */

export interface BannerData {
  todayCostUsd: number
  activeWakes: number
  pausedRules: number
  budgetCapUsd: number | null
  percentUsed: number | null
}

export interface AutomationRow {
  id: string
  name: string
  eventName: string
  actionType: 'wake' | 'webhook'
  actionAgentId: string | null
  lane: 'conversation' | 'standalone' | null
  paused: boolean
  pausedReason: string | null
  pausedAt: string | null
  cron: string | null
  fireCount24h: number
  suppressionCount24h: number
  lastFire: string | null
  lastStatus: string | null
}

export interface RunRow {
  id: string
  ruleId: string
  ruleName: string | null
  eventName: string
  status: string
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  wakeId: string | null
  costUsd: number
  errorMessage: string | null
}

export interface ActiveWakeRow {
  conversationId: string
  workerId: string
  startedAt: string
  debounceUntil: string
}
