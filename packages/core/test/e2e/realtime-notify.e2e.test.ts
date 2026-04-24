/**
 * E2E: realtime LISTEN/NOTIFY through a drizzle transaction.
 *
 * Validates the transactional guarantee of RealtimeService.notify(payload, tx):
 * NOTIFY must only be delivered on commit — a rolled-back tx must not fire
 * subscribers. This is the property the `notify(tx)` overload exists for.
 */

import { beforeAll, describe, expect, it } from 'bun:test'

import { createRealtimeService, type RealtimePayload } from '../../src/realtime'
import { freshDb } from '../helpers/pglite'
import type { VobaseDb } from '../../src/db/client'

let db: VobaseDb

beforeAll(async () => {
  const { db: d } = await freshDb()
  db = d
})

function collect(svc: Awaited<ReturnType<typeof createRealtimeService>>): RealtimePayload[] {
  const received: RealtimePayload[] = []
  svc.subscribe((raw) => received.push(JSON.parse(raw) as RealtimePayload))
  return received
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 80))
}

describe('RealtimeService transactional notify (e2e)', () => {
  it('delivers notifications issued on the outer db handle', async () => {
    const svc = await createRealtimeService('memory://', db)
    const received = collect(svc)

    await svc.notify({ table: 'threads', id: 'a', action: 'insert' })
    await flush()

    expect(received.map((p) => p.id)).toEqual(['a'])
    await svc.shutdown()
  })

  it('delivers notifications emitted inside a committed transaction', async () => {
    const svc = await createRealtimeService('memory://', db)
    const received = collect(svc)

    await db.transaction(async (tx) => {
      await svc.notify({ table: 'threads', id: 'tx-commit', action: 'insert' }, tx)
    })
    await flush()

    expect(received.some((p) => p.id === 'tx-commit')).toBe(true)
    await svc.shutdown()
  })

  it('suppresses notifications when the transaction rolls back', async () => {
    const svc = await createRealtimeService('memory://', db)
    const received = collect(svc)

    await expect(
      db.transaction(async (tx) => {
        await svc.notify({ table: 'threads', id: 'tx-rollback', action: 'insert' }, tx)
        throw new Error('forced rollback')
      }),
    ).rejects.toThrow('forced rollback')
    await flush()

    expect(received.some((p) => p.id === 'tx-rollback')).toBe(false)
    await svc.shutdown()
  })

  it('supports multiple subscribers — all see every event', async () => {
    const svc = await createRealtimeService('memory://', db)
    const a: RealtimePayload[] = []
    const b: RealtimePayload[] = []
    svc.subscribe((raw) => a.push(JSON.parse(raw) as RealtimePayload))
    svc.subscribe((raw) => b.push(JSON.parse(raw) as RealtimePayload))

    await svc.notify({ table: 'threads', id: 'multi-1' })
    await svc.notify({ table: 'threads', id: 'multi-2' })
    await flush()

    expect(a.filter((p) => p.id?.startsWith('multi-'))).toHaveLength(2)
    expect(b.filter((p) => p.id?.startsWith('multi-'))).toHaveLength(2)
    await svc.shutdown()
  })

  it('unsubscribe handle stops further delivery to that subscriber', async () => {
    const svc = await createRealtimeService('memory://', db)
    const received: RealtimePayload[] = []
    const unsub = svc.subscribe((raw) => received.push(JSON.parse(raw) as RealtimePayload))

    await svc.notify({ table: 'threads', id: 'before-unsub' })
    await flush()
    unsub()
    await svc.notify({ table: 'threads', id: 'after-unsub' })
    await flush()

    const ids = received.map((p) => p.id)
    expect(ids).toContain('before-unsub')
    expect(ids).not.toContain('after-unsub')
    await svc.shutdown()
  })
})
