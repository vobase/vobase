import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import {
  __resetSchedulesServiceForTests,
  installSchedulesService,
  type SchedulesService,
} from '@modules/schedules/service/schedules'
import type { ToolContext } from '@vobase/core'

import { createScheduleTool } from './create-schedule'

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

describe('createScheduleTool', () => {
  beforeEach(() => __resetSchedulesServiceForTests())

  it('rejects malformed slug', async () => {
    installSchedulesService({} as SchedulesService)
    const result = await createScheduleTool.execute({ slug: 'Invalid Slug', cron: '0 18 * * *' } as never, ctx())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('VALIDATION_ERROR')
  })

  it('defaults agentId to ctx.agentId when omitted', async () => {
    let received: unknown = null
    installSchedulesService({
      create: (input) => {
        received = input
        return Promise.resolve({ scheduleId: 'sch1' })
      },
      setEnabled: () => Promise.resolve(),
      recordTick: () => Promise.resolve({ idempotencyKey: '', firstFire: false }),
      listEnabled: () => Promise.resolve([]),
      listAll: () => Promise.resolve([]),
      getById: () => Promise.resolve(undefined),
      listAllEnabled: () => Promise.resolve([]),
    })
    const result = await createScheduleTool.execute({ slug: 'daily-brief', cron: '0 18 * * *' }, ctx())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.content.scheduleId).toBe('sch1')
    expect((received as { agentId: string }).agentId).toBe(AGENT_ID)
  })

  it('honours explicit agentId override', async () => {
    let received: unknown = null
    installSchedulesService({
      create: (input) => {
        received = input
        return Promise.resolve({ scheduleId: 'sch2' })
      },
      setEnabled: () => Promise.resolve(),
      recordTick: () => Promise.resolve({ idempotencyKey: '', firstFire: false }),
      listEnabled: () => Promise.resolve([]),
      listAll: () => Promise.resolve([]),
      getById: () => Promise.resolve(undefined),
      listAllEnabled: () => Promise.resolve([]),
    })
    await createScheduleTool.execute({ slug: 'other', cron: '0 8 * * *', agentId: 'agt0other' }, ctx())
    expect((received as { agentId: string }).agentId).toBe('agt0other')
  })
})
