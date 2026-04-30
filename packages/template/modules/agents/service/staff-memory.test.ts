/**
 * Unit tests for the staff-memory no-op NOTIFY guard.
 *
 * Distill loops can call `upsert` repeatedly with identical content; firing
 * `realtime.notify` on every call would drown SSE consumers. The guard SELECTs
 * the current memory before the upsert and skips the notify when bytes match.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import { createStaffMemoryService } from './staff-memory'

interface FakeRow {
  organizationId: string
  agentId: string
  staffId: string
  memory: string
}

/**
 * Hand-rolled chainable stub that mimics the slice of drizzle-orm the
 * StaffMemoryService uses. Stores rows in-memory keyed by composite identity
 * so repeated upserts can observe the prior state.
 */
function fakeDb(initial: FakeRow[] = []) {
  const rows: FakeRow[] = [...initial]
  return {
    rows,
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(rows.map((r) => ({ memory: r.memory }))),
        }),
      }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        const incoming = v as FakeRow
        return {
          onConflictDoUpdate: ({ set }: { set: { memory: string } }) => {
            const existing = rows.find(
              (r) =>
                r.organizationId === incoming.organizationId &&
                r.agentId === incoming.agentId &&
                r.staffId === incoming.staffId,
            )
            if (existing) existing.memory = set.memory
            else rows.push(incoming)
            return Promise.resolve()
          },
        }
      },
    }),
  }
}

const KEY = { organizationId: 'org-1', agentId: 'agt-1', staffId: 'staff-1' }
const MEMORY = '## Notes\nSomething worth remembering.'

describe('staff-memory upsert NOTIFY guard', () => {
  let notify: ReturnType<typeof mock>

  beforeEach(() => {
    notify = mock(() => {})
  })

  afterEach(() => {
    mock.restore()
  })

  it('fires realtime.notify on first write (no prior row)', async () => {
    const db = fakeDb([])
    const svc = createStaffMemoryService({ db, realtime: { notify } as never })
    await svc.upsert(KEY, MEMORY)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('fires realtime.notify when memory bytes change', async () => {
    const db = fakeDb([{ ...KEY, memory: MEMORY }])
    const svc = createStaffMemoryService({ db, realtime: { notify } as never })
    await svc.upsert(KEY, `${MEMORY}\n## More\nNew section.`)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('skips realtime.notify when upsert value is byte-identical to existing memory', async () => {
    const db = fakeDb([{ ...KEY, memory: MEMORY }])
    const svc = createStaffMemoryService({ db, realtime: { notify } as never })
    await svc.upsert(KEY, MEMORY)
    expect(notify).not.toHaveBeenCalled()
  })
})
