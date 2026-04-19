/** Synchronous steer queue — push from pg LISTEN callbacks, drain at turn boundaries. */

export interface SteerQueueHandle {
  push(text: string): void
  /** Returns and clears all pending steer texts in insertion order. */
  drain(): string[]
}

export function createSteerQueue(): SteerQueueHandle {
  const pending: string[] = []
  return {
    push(text) {
      pending.push(text)
    },
    drain() {
      return pending.splice(0)
    },
  }
}
