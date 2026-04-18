/**
 * ObserverBus — per-observer worker loop. Spec §12.2.
 *
 * One queue per observer; a slow observer cannot backpressure a fast one
 * (the integration test's bench assertion verifies this at P1.1 acceptance).
 * Throws inside `observer.handle()` are swallowed + logged.
 */
import type { AgentEvent } from '@server/contracts/event'
import type { AgentObserver, Logger, ObserverContext } from '@server/contracts/observer'
import { AsyncQueue } from './async-queue'

export interface ObserverBusOptions {
  logger: Logger
  observerCtx: ObserverContext
}

export class ObserverBus {
  private readonly queues = new Map<string, AsyncQueue<AgentEvent>>()
  private readonly workers = new Map<string, Promise<void>>()
  private readonly logger: Logger
  private readonly observerCtx: ObserverContext

  constructor(opts: ObserverBusOptions) {
    this.logger = opts.logger
    this.observerCtx = opts.observerCtx
  }

  register(observer: AgentObserver): void {
    if (this.queues.has(observer.id)) {
      throw new Error(`observer-bus: duplicate observer id "${observer.id}"`)
    }
    const queue = new AsyncQueue<AgentEvent>()
    this.queues.set(observer.id, queue)
    this.workers.set(observer.id, this.runWorker(observer, queue))
  }

  publish(event: AgentEvent): void {
    for (const queue of this.queues.values()) {
      queue.enqueue(event)
    }
  }

  async shutdown(): Promise<void> {
    for (const queue of this.queues.values()) queue.close()
    await Promise.all(this.workers.values())
  }

  private async runWorker(observer: AgentObserver, queue: AsyncQueue<AgentEvent>): Promise<void> {
    for await (const event of queue) {
      try {
        await observer.handle(event, this.observerCtx)
      } catch (err) {
        this.logger.error(
          { observerId: observer.id, eventType: event.type, err: String(err) },
          'observer threw — swallowed',
        )
      }
    }
  }
}
