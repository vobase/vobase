/**
 * Unit tests for the self_reflection triage enqueue wired into conversation-lane wakes.
 *
 * Tests `enqueueSelfReflection` directly — no harness boot, no DB. The helper
 * is the extracted form of the inline `selfReflectionListener` so a future
 * signature change fails typecheck here before reaching CI.
 */

import { afterEach, describe, expect, it, mock } from 'bun:test'
import type { ScopedScheduler } from '@vobase/core'

import { enqueueSelfReflection, type SelfReflectionCtx } from './self-reflection'

// Mirrors LEARNING_TRIAGE_JOB from wake/learning/triage-job.ts — inlined here
// so the test stays free of the agents/schema import chain.
const LEARNING_TRIAGE_JOB = 'learning:triage'

const ORG = 'org_test'
const AGENT = 'a_test'
const CONV = 'conv_test'
const WAKE_ID = 'wake_abc'

function makeMockJobs(): { scheduler: ScopedScheduler; calls: Array<[string, unknown]> } {
  const calls: Array<[string, unknown]> = []
  const scheduler: ScopedScheduler = {
    send: mock(async (name: string, data: unknown) => {
      calls.push([name, data])
      return 'job_id'
    }),
    cancel: mock(async () => {}),
  }
  return { scheduler, calls }
}

function makeCtx(jobs: ScopedScheduler): SelfReflectionCtx {
  return { jobs, organizationId: ORG, agentId: AGENT, conversationId: CONV }
}

describe('enqueueSelfReflection', () => {
  it('enqueues one learning:triage job with self_reflection signal on agent_end', async () => {
    const { scheduler, calls } = makeMockJobs()
    await enqueueSelfReflection(makeCtx(scheduler), { wakeId: WAKE_ID })

    expect(calls).toHaveLength(1)
    const [jobName, payload] = calls[0]
    expect(jobName).toBe(LEARNING_TRIAGE_JOB)
    expect(payload).toMatchObject({
      organizationId: ORG,
      agentId: AGENT,
      conversationId: CONV,
      signal: { kind: 'self_reflection', wakeId: WAKE_ID },
    })
    // Body is a fixed prompt that points triage at the journal context;
    // assert non-empty so a future regression to body:'' is caught, but
    // don't pin the wording (it gets tuned during slice 3 calibration).
    const body = (payload as { signal: { body: string } }).signal.body
    expect(body.length).toBeGreaterThan(40)
  })

  it('swallows jobs.send errors without throwing', async () => {
    const failing: ScopedScheduler = {
      send: mock(async () => {
        throw new Error('pg-boss unavailable')
      }),
      cancel: mock(async () => {}),
    }
    // Must not throw — errors are console.warn'd and swallowed
    await expect(enqueueSelfReflection(makeCtx(failing), { wakeId: WAKE_ID })).resolves.toBeUndefined()
  })

  it('sends the wakeId verbatim from the event', async () => {
    const { scheduler, calls } = makeMockJobs()
    await enqueueSelfReflection(makeCtx(scheduler), { wakeId: 'specific_wake_123' })
    const payload = calls[0][1] as { signal: { wakeId: string } }
    expect(payload.signal.wakeId).toBe('specific_wake_123')
  })
})

describe('enqueueSelfReflection auto-triage kill-switch', () => {
  const ORIGINAL = process.env.LEARN_AUTO_TRIAGE

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.LEARN_AUTO_TRIAGE
    else process.env.LEARN_AUTO_TRIAGE = ORIGINAL
  })

  it('enqueues by default (auto-triage on)', async () => {
    delete process.env.LEARN_AUTO_TRIAGE
    const { scheduler, calls } = makeMockJobs()
    await enqueueSelfReflection(makeCtx(scheduler), { wakeId: WAKE_ID })
    expect(calls).toHaveLength(1)
  })

  it('does not enqueue when LEARN_AUTO_TRIAGE is explicitly disabled', async () => {
    process.env.LEARN_AUTO_TRIAGE = '0'
    const { scheduler, calls } = makeMockJobs()
    await enqueueSelfReflection(makeCtx(scheduler), { wakeId: WAKE_ID })
    expect(calls).toHaveLength(0)
  })
})
