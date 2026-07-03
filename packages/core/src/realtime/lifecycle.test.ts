import { describe, expect, it } from 'bun:test'

import { createScopedListener, type ScopedListenerConn } from './lifecycle'

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

interface Harness {
  opens: number
  closes: number
  failNextOpens: number
  conn(): ScopedListenerConn
  open(): Promise<ScopedListenerConn>
}

function makeHarness(): Harness {
  const h: Harness = {
    opens: 0,
    closes: 0,
    failNextOpens: 0,
    conn() {
      return {
        close: () => {
          h.closes += 1
          return Promise.resolve()
        },
      }
    },
    open() {
      if (h.failNextOpens > 0) {
        h.failNextOpens -= 1
        return Promise.reject(new Error('open failed'))
      }
      h.opens += 1
      return Promise.resolve(h.conn())
    },
  }
  return h
}

describe('createScopedListener', () => {
  it('does not open until the first retain', async () => {
    const h = makeHarness()
    const listener = createScopedListener({ open: () => h.open(), lingerMs: 10 })
    await listener.ready()
    expect(h.opens).toBe(0)
    expect(listener.isOpen()).toBe(false)

    listener.retain()
    await listener.ready()
    expect(h.opens).toBe(1)
    expect(listener.isOpen()).toBe(true)
    await listener.shutdown()
  })

  it('opens once for multiple concurrent retains', async () => {
    const h = makeHarness()
    const listener = createScopedListener({ open: () => h.open(), lingerMs: 10 })
    listener.retain()
    listener.retain()
    listener.retain()
    await listener.ready()
    expect(h.opens).toBe(1)
    await listener.shutdown()
  })

  it('closes after the linger once the last subscriber releases', async () => {
    const h = makeHarness()
    const listener = createScopedListener({ open: () => h.open(), lingerMs: 10 })
    listener.retain()
    listener.retain()
    await listener.ready()

    listener.release()
    await sleep(30)
    expect(h.closes).toBe(0) // one subscriber left — still open

    listener.release()
    expect(listener.isOpen()).toBe(true) // linger window
    await sleep(30)
    expect(h.closes).toBe(1)
    expect(listener.isOpen()).toBe(false)
    await listener.shutdown()
  })

  it('a retain during the linger window keeps the connection', async () => {
    const h = makeHarness()
    const listener = createScopedListener({ open: () => h.open(), lingerMs: 20 })
    listener.retain()
    await listener.ready()

    listener.release()
    listener.retain()
    await sleep(50)
    expect(h.closes).toBe(0)
    expect(h.opens).toBe(1)
    expect(listener.isOpen()).toBe(true)
    await listener.shutdown()
  })

  it('reopens for a subscriber arriving after teardown', async () => {
    const h = makeHarness()
    const listener = createScopedListener({ open: () => h.open(), lingerMs: 5 })
    listener.retain()
    await listener.ready()
    listener.release()
    await sleep(20)
    expect(h.closes).toBe(1)

    listener.retain()
    await listener.ready()
    expect(h.opens).toBe(2)
    expect(listener.isOpen()).toBe(true)
    await listener.shutdown()
  })

  it('retries a failed open with backoff while subscribers remain', async () => {
    const h = makeHarness()
    h.failNextOpens = 1
    const errors: unknown[] = []
    const listener = createScopedListener({
      open: () => h.open(),
      lingerMs: 10,
      retryBaseMs: 10,
      retryMaxMs: 20,
      onError: (err) => errors.push(err),
    })
    listener.retain()
    await listener.ready()
    expect(listener.isOpen()).toBe(false)
    expect(errors).toHaveLength(1)

    await sleep(40)
    expect(listener.isOpen()).toBe(true)
    expect(h.opens).toBe(1)
    await listener.shutdown()
  })

  it('stops retrying once every subscriber releases', async () => {
    const h = makeHarness()
    h.failNextOpens = 100
    let attempts = 0
    const listener = createScopedListener({
      open: () => {
        attempts += 1
        return h.open()
      },
      lingerMs: 5,
      retryBaseMs: 5,
      retryMaxMs: 5,
    })
    listener.retain()
    await listener.ready()
    listener.release()
    const attemptsAtRelease = attempts
    await sleep(40)
    expect(attempts).toBe(attemptsAtRelease)
    await listener.shutdown()
  })

  it('shutdown closes the connection and ignores later retains', async () => {
    const h = makeHarness()
    const listener = createScopedListener({ open: () => h.open(), lingerMs: 10 })
    listener.retain()
    await listener.ready()
    await listener.shutdown()
    expect(h.closes).toBe(1)

    listener.retain()
    await listener.ready()
    expect(h.opens).toBe(1)
    expect(listener.isOpen()).toBe(false)
  })

  it('an unbalanced release does not poison a later retain', async () => {
    const h = makeHarness()
    const listener = createScopedListener({ open: () => h.open(), lingerMs: 5 })
    listener.release()
    listener.retain()
    await listener.ready()
    expect(listener.isOpen()).toBe(true)
    await listener.shutdown()
  })
})
