/**
 * Internal harness bus utilities — temporarily co-located with agent-runner
 * during slice 2c.3. `EventBus`, `ObserverBus`, `MutatorChain`, `AsyncQueue`
 * were moved here from `server/runtime/` so we can keep `bootWake`'s legacy
 * `AgentObserver` / `AgentMutator` plumbing alive while phase A commits land.
 * Phase B rewrites observers to pure `OnEventListener` and phase D replaces
 * `MutatorChain` with `OnToolCallListener`s — at which point this file is
 * deleted.
 */
import type { AgentEvent } from '@server/contracts/event'
import type { AgentMutator, AgentStep, MutatorContext, MutatorDecision, StepResult } from '@server/contracts/mutator'
import type { AgentObserver, Logger } from '@server/contracts/observer'
import type { EventBus as EventBusContract } from '@server/contracts/plugin-context'

// ─── AsyncQueue ────────────────────────────────────────────────────────────

class AsyncQueue<T> {
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

// ─── EventBus ──────────────────────────────────────────────────────────────

type Subscriber = (event: AgentEvent) => void | Promise<void>

export type WakeReleasedHook = (payload: {
  conversationId: string
  wakeId: string
  organizationId: string
  reason: string
}) => void | Promise<void>

export class EventBus implements EventBusContract {
  private readonly subscribers = new Set<Subscriber>()
  private readonly onError: (err: unknown, event: AgentEvent) => void
  private readonly onWakeReleased: WakeReleasedHook | undefined

  constructor(opts?: {
    onError?: (err: unknown, event: AgentEvent) => void
    onWakeReleased?: WakeReleasedHook
  }) {
    this.onError = opts?.onError ?? (() => undefined)
    this.onWakeReleased = opts?.onWakeReleased
  }

  publish(event: AgentEvent): void {
    for (const sub of this.subscribers) {
      try {
        const result = sub(event)
        if (result && typeof (result as Promise<void>).then === 'function') {
          ;(result as Promise<void>).catch((err) => this.onError(err, event))
        }
      } catch (err) {
        this.onError(err, event)
      }
    }
    if (event.type === 'agent_end' && this.onWakeReleased) {
      try {
        const result = this.onWakeReleased({
          conversationId: event.conversationId,
          wakeId: event.wakeId,
          organizationId: event.organizationId,
          reason: event.reason,
        })
        if (result && typeof (result as Promise<void>).then === 'function') {
          ;(result as Promise<void>).catch((err) => this.onError(err, event))
        }
      } catch (err) {
        this.onError(err, event)
      }
    }
  }

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn)
    return () => {
      this.subscribers.delete(fn)
    }
  }

  size(): number {
    return this.subscribers.size
  }
}

// ─── ObserverBus ───────────────────────────────────────────────────────────

export interface ObserverBusOptions {
  logger: Logger
}

export class ObserverBus {
  private readonly queues = new Map<string, AsyncQueue<AgentEvent>>()
  private readonly workers = new Map<string, Promise<void>>()
  private readonly logger: Logger

  constructor(opts: ObserverBusOptions) {
    this.logger = opts.logger
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
        await observer.handle(event)
      } catch (err) {
        this.logger.error(
          { observerId: observer.id, eventType: event.type, err: String(err) },
          'observer threw — swallowed',
        )
      }
    }
  }
}

// ─── MutatorChain ──────────────────────────────────────────────────────────

export class MutatorChain {
  constructor(private readonly mutators: readonly AgentMutator[]) {}

  static empty(): MutatorChain {
    return new MutatorChain([])
  }

  async runBefore(step: AgentStep, ctx: MutatorContext): Promise<MutatorDecision | undefined> {
    let currentArgs = step.args
    for (const m of this.mutators) {
      if (!m.before) continue
      const decision = await m.before({ ...step, args: currentArgs }, ctx)
      if (!decision) continue
      if (decision.action === 'block') return decision
      if (decision.action === 'transform') currentArgs = decision.args
    }
    return undefined
  }

  async runAfter(step: AgentStep, result: StepResult, ctx: MutatorContext): Promise<StepResult> {
    let current = result
    for (const m of this.mutators) {
      if (!m.after) continue
      const replacement = await m.after(step, current, ctx)
      if (replacement) current = replacement
    }
    return current
  }

  size(): number {
    return this.mutators.length
  }
}
