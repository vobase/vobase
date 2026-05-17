import { describe, expect, it } from 'bun:test'

import type { Tx } from '~/runtime'
import { emit } from './events'

describe('emit()', () => {
  it('resolves with valid cron payload and tx', async () => {
    await expect(
      emit('cron', { scheduleId: 'sched-1', intendedRunAt: '2026-05-17T00:00:00Z' }, { tx: {} as Tx }),
    ).resolves.toBeUndefined()
  })

  it('rejects with Zod error when payload is invalid', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional invalid payload for test
    await expect(emit('cron', { scheduleId: 1 } as any, { tx: {} as Tx })).rejects.toThrow()
  })
})

// Compile-time type assertions. This function is never called; it exists solely
// so tsc validates the @ts-expect-error directives on the lines below.
function _compileTimeChecks() {
  // @ts-expect-error -- missing third arg: { tx } is required, no overload accepts 2 args
  emit('cron', { scheduleId: 'x', intendedRunAt: '2026-05-17T00:00:00Z' })

  // @ts-expect-error -- 'not_a_real_event' is not assignable to EventName
  emit('not_a_real_event', {}, { tx: {} as Tx })
}
