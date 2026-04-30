import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { __resetSchedulesServiceForTests, installSchedulesService } from '@modules/schedules/service/schedules'
import type { ToolContext } from '@vobase/core'

import { pauseScheduleTool } from './pause-schedule'

const ORG_ID = 'org0test0'
const AGENT_ID = 'agt0op0001'

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    organizationId: ORG_ID,
    conversationId: 'conv1',
    wakeId: 'wake1',
    agentId: AGENT_ID,
    turnIndex: 0,
    toolCallId: 'call1',
    ...overrides,
  }
}

afterAll(() => {
  __resetSchedulesServiceForTests()
})

describe('pauseScheduleTool', () => {
  beforeEach(() => __resetSchedulesServiceForTests())

  it('defaults enabled to false (pause)', async () => {
    let received: unknown = null
    installSchedulesService({
      create: () => Promise.resolve({ scheduleId: '' }),
      setEnabled: (input) => {
        received = input
        return Promise.resolve()
      },
      recordTick: () => Promise.resolve({ idempotencyKey: '', firstFire: false }),
      listEnabled: () => Promise.resolve([]),
      listAll: () => Promise.resolve([]),
      getById: () => Promise.resolve(undefined),
      listAllEnabled: () => Promise.resolve([]),
    })
    const result = await pauseScheduleTool.execute({ scheduleId: 'sch1' }, ctx())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.content).toEqual({ scheduleId: 'sch1', enabled: false })
    expect(received).toEqual({ scheduleId: 'sch1', enabled: false })
  })

  it('passes through enabled=true to resume', async () => {
    let received: unknown = null
    installSchedulesService({
      create: () => Promise.resolve({ scheduleId: '' }),
      setEnabled: (input) => {
        received = input
        return Promise.resolve()
      },
      recordTick: () => Promise.resolve({ idempotencyKey: '', firstFire: false }),
      listEnabled: () => Promise.resolve([]),
      listAll: () => Promise.resolve([]),
      getById: () => Promise.resolve(undefined),
      listAllEnabled: () => Promise.resolve([]),
    })
    await pauseScheduleTool.execute({ scheduleId: 'sch2', enabled: true }, ctx())
    expect((received as { enabled: boolean }).enabled).toBe(true)
  })
})
