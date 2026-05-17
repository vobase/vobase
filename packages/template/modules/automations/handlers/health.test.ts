/**
 * Shape test for /health/automations (US-015 / Slice D.3).
 *
 * Confirms the route is wired and returns the three documented numeric keys.
 * Heavy timing assertions live in the budget-watcher integration test.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createSystemService, installSystemService } from '@modules/system/service'

import type { TestDbHandle } from '../../../tests/helpers/test-db'
import { connectTestDb, resetAndSeedDb } from '../../../tests/helpers/test-db'
import healthApp from './health'

describe('GET /health/automations', () => {
  let handle: TestDbHandle

  beforeAll(async () => {
    await resetAndSeedDb()
    handle = connectTestDb()
    installSystemService(createSystemService({ db: handle.db }))
  })

  afterAll(async () => {
    await handle.teardown()
  })

  it('exposes /health/automations', () => {
    const routes = healthApp.routes.map((r) => r.path)
    expect(routes).toContain('/health/automations')
  })

  it('returns lastDispatchAgeSec, queueDepth, watcherLastTickAgeSec', async () => {
    const res = await healthApp.request('/health/automations')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['lastDispatchAgeSec', 'queueDepth', 'watcherLastTickAgeSec'].sort())
    // Each value is either null or a number.
    for (const key of ['lastDispatchAgeSec', 'queueDepth', 'watcherLastTickAgeSec'] as const) {
      const v = body[key]
      expect(v === null || typeof v === 'number').toBe(true)
    }
  })
})
