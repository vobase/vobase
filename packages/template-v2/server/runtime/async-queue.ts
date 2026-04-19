/**
 * Hand-written 8-line AsyncQueue. NOT vendored from pi-mono.
 *
 * Backing structure for the per-observer queue in `observer-bus.ts`.
 * A slow observer's queue grows without backpressuring the bus itself or other
 * observers; the bus enqueues to every observer's queue synchronously.
 */
export class AsyncQueue<T> {
  private readonly items: T[] = []
  private readonly pending: Array<(v: IteratorResult<T>) => void> = []
  private closed = false

  enqueue(item: T): void {
    if (this.closed) return
    const waiter = this.pending.shift()
    if (waiter) {
      waiter({ value: item, done: false })
    } else {
      this.items.push(item)
    }
  }

  close(): void {
    this.closed = true
    while (this.pending.length) {
      const waiter = this.pending.shift()
      if (waiter) waiter({ value: undefined as never, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        const item = this.items.shift()
        if (item !== undefined) {
          return Promise.resolve({ value: item, done: false })
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as never, done: true })
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.pending.push(resolve)
        })
      },
      [Symbol.asyncIterator](): AsyncIterableIterator<T> {
        return this
      },
    }
  }
}
