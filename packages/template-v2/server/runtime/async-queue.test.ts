import { describe, expect, it } from 'bun:test'
import { AsyncQueue } from './async-queue'

describe('AsyncQueue', () => {
  it('delivers items enqueued before the async iterator advances', async () => {
    const q = new AsyncQueue<number>()
    q.enqueue(1)
    q.enqueue(2)
    q.close()
    const out: number[] = []
    for await (const n of q) out.push(n)
    expect(out).toEqual([1, 2])
  })

  it('delivers items enqueued AFTER the consumer has started waiting', async () => {
    const q = new AsyncQueue<string>()
    const consumer = (async () => {
      const out: string[] = []
      for await (const s of q) out.push(s)
      return out
    })()
    // give the consumer a tick to park on the pending-waiters queue
    await Promise.resolve()
    q.enqueue('a')
    q.enqueue('b')
    q.close()
    expect(await consumer).toEqual(['a', 'b'])
  })

  it('closing while a consumer is waiting terminates the iterator', async () => {
    const q = new AsyncQueue<number>()
    const consumer = (async () => {
      const out: number[] = []
      for await (const n of q) out.push(n)
      return out
    })()
    await Promise.resolve()
    q.close()
    expect(await consumer).toEqual([])
  })
})
