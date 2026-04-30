/**
 * Unit tests for `createHeartbeatEmitter` — the seam between the schedules
 * cron-tick driver and `standaloneWakeConfig`.
 *
 * We swap the agent-definitions service for a stub so the emitter doesn't
 * touch the DB; `standaloneWakeConfig` itself is not invoked here (the
 * test would need a real workspace + drive port). Instead we verify that
 * the emitter looks up the agent definition and tolerates errors without
 * throwing — the cron-tick must keep iterating siblings even when one
 * heartbeat fails.
 */

import { afterEach, describe, expect, it } from 'bun:test'
import {
  __resetAgentDefinitionsServiceForTests,
  type AgentDefinitionsService,
  installAgentDefinitionsService,
} from '@modules/agents/service/agent-definitions'
import type { HeartbeatTrigger } from '@modules/schedules/jobs'
import type { AgentContributions, HarnessLogger } from '@vobase/core'

import { createHeartbeatEmitter } from './heartbeat'

const NOOP_LOGGER: HarnessLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

const NOOP_CONTRIBUTIONS: AgentContributions = {
  tools: [],
  listeners: {},
  materializers: [],
  sideLoad: [],
  agentsMd: [],
  roHints: [],
}

const TRIGGER: HeartbeatTrigger = {
  kind: 'heartbeat',
  scheduleId: 'sch_test',
  agentId: 'agt_op',
  organizationId: 'org_t',
  intendedRunAt: '2026-04-26T18:00:00.000Z',
  cron: '0 18 * * *',
}

afterEach(() => __resetAgentDefinitionsServiceForTests())

describe('createHeartbeatEmitter', () => {
  it('does not throw when the agent lookup fails', async () => {
    installAgentDefinitionsService({
      getById: () => Promise.reject(new Error('agent not found')),
    } as unknown as AgentDefinitionsService)
    const deps = { realtime: { notify: () => {} } as never, db: {} as never, logger: NOOP_LOGGER }
    const emit = createHeartbeatEmitter(deps, NOOP_CONTRIBUTIONS)
    await expect(emit(TRIGGER)).resolves.toBeUndefined()
  })

  it('attempts to resolve the agent for the heartbeat trigger', async () => {
    let lookupCount = 0
    installAgentDefinitionsService({
      getById: (id: string) => {
        lookupCount++
        expect(id).toBe('agt_op')
        // Reject so we don't enter standaloneWakeConfig (no real workspace).
        return Promise.reject(new Error('stop here'))
      },
    } as unknown as AgentDefinitionsService)
    const deps = { realtime: { notify: () => {} } as never, db: {} as never, logger: NOOP_LOGGER }
    const emit = createHeartbeatEmitter(deps, NOOP_CONTRIBUTIONS)
    await emit(TRIGGER)
    expect(lookupCount).toBe(1)
  })
})
