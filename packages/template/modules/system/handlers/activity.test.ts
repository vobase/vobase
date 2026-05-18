/**
 * Shape tests for /api/automations/* endpoints.
 *
 * Heavy DB-driven assertions live in the budget-caps / dispatcher integration
 * tests that already exercise the underlying services. Here we lock down two
 * things:
 *
 *   1. The four routes are registered (typo / wiring regressions).
 *   2. The response keys promised to `modules/system/hooks/use-activity.ts`
 *      stay stable — verified via a TypeScript-only shape check below.
 */

import { describe, expect, it } from 'bun:test'

import type { ActiveWakeRow, AutomationRow, BannerData, RunRow } from '../activity-types'
import activityApp from './activity'

describe('activity endpoint registration', () => {
  const routes = activityApp.routes.map((r) => r.path)

  it('exposes /activity/banner', () => {
    expect(routes).toContain('/activity/banner')
  })

  it('exposes /activity/automations', () => {
    expect(routes).toContain('/activity/automations')
  })

  it('exposes /activity/runs', () => {
    expect(routes).toContain('/activity/runs')
  })

  it('exposes /activity/active-wakes', () => {
    expect(routes).toContain('/activity/active-wakes')
  })
})

describe('activity response contract — compile-time shape', () => {
  it('BannerData carries all five banner stats', () => {
    const sample: BannerData = {
      todayCostUsd: 0.5,
      activeWakes: 2,
      pausedRules: 1,
      budgetCapUsd: 5,
      percentUsed: 10,
    }
    expect(Object.keys(sample).sort()).toEqual(
      ['activeWakes', 'budgetCapUsd', 'pausedRules', 'percentUsed', 'todayCostUsd'].sort(),
    )
  })

  it('AutomationRow carries the action + 24h aggregate fields', () => {
    const sample: AutomationRow = {
      id: 'r1',
      name: 'demo',
      eventName: 'cron',
      actionType: 'wake',
      actionAgentId: 'agt0test01',
      lane: 'standalone',
      paused: false,
      pausedReason: null,
      pausedAt: null,
      cron: '* * * * *',
      fireCount24h: 3,
      suppressionCount24h: 0,
      lastFire: null,
      lastStatus: 'succeeded',
    }
    expect(sample.actionType).toBe('wake')
  })

  it('RunRow carries the joined per-wake cost', () => {
    const sample: RunRow = {
      id: 'run1',
      ruleId: 'r1',
      ruleName: 'demo',
      eventName: 'cron',
      status: 'succeeded',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      durationMs: 12,
      wakeId: 'wake_abc12345',
      costUsd: 0.0042,
      errorMessage: null,
    }
    expect(typeof sample.costUsd).toBe('number')
  })

  it('ActiveWakeRow carries conversation + worker + timestamps', () => {
    const sample: ActiveWakeRow = {
      conversationId: 'conv_1',
      workerId: 'worker_a',
      startedAt: new Date().toISOString(),
      debounceUntil: new Date().toISOString(),
    }
    expect(sample.conversationId).toBe('conv_1')
  })
})
