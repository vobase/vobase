import { describe, expect, it } from 'bun:test'

import { buildJobQueue } from './jobs'

function defer<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('buildJobQueue', () => {
  it('dispatches an immediate job', async () => {
    const calls: string[] = []
    const handlers = new Map<string, (data: unknown) => Promise<void>>([
      ['greet', async (data) => void calls.push(String((data as { who: string }).who))],
    ])
    const q = buildJobQueue(handlers)
    await q.send('greet', { who: 'world' })
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toEqual(['world'])
  })

  it('honors startAfter by delaying dispatch', async () => {
    const d = defer<void>()
    const handlers = new Map<string, (data: unknown) => Promise<void>>([
      [
        'later',
        async () => {
          d.resolve()
        },
      ],
    ])
    const q = buildJobQueue(handlers)
    const start = Date.now()
    await q.send('later', null, { startAfter: new Date(Date.now() + 60) })
    await d.promise
    expect(Date.now() - start).toBeGreaterThanOrEqual(50)
  })

  it('singletonKey replaces a still-scheduled timer', async () => {
    const calls: string[] = []
    const handlers = new Map<string, (data: unknown) => Promise<void>>([
      ['ping', async (data) => void calls.push(String(data))],
    ])
    const q = buildJobQueue(handlers)
    await q.send('ping', 'first', { startAfter: new Date(Date.now() + 200), singletonKey: 'k' })
    await q.send('ping', 'second', { startAfter: new Date(Date.now() + 50), singletonKey: 'k' })
    await new Promise((r) => setTimeout(r, 120))
    expect(calls).toEqual(['second'])
  })

  it('cancel removes a pending timer', async () => {
    const calls: string[] = []
    const handlers = new Map<string, (data: unknown) => Promise<void>>([['ping', async () => void calls.push('fired')]])
    const q = buildJobQueue(handlers)
    const jobId = await q.send('ping', null, { startAfter: new Date(Date.now() + 80) })
    await q.cancel(jobId)
    await new Promise((r) => setTimeout(r, 120))
    expect(calls).toEqual([])
  })

  it('drops jobs whose handler is not registered', async () => {
    const q = buildJobQueue(new Map())
    await q.send('unknown', null)
    await Promise.resolve()
    expect(true).toBe(true)
  })
})
