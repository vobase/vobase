import type { Tx } from '~/runtime'
import { type EventName, type EventPayload, eventRegistry } from './registry'

/**
 * Typed event bus. Producers call `emit(name, payload, { tx })` inside their
 * own `db.transaction(...)` callback. The emit row lands in the same Postgres
 * tx via the pg-boss bridge (`tx-bridge.ts`), so rollback ⇒ emit vanishes.
 *
 * `{ tx }` is REQUIRED at the type level — no fire-and-forget overload.
 * Missing `tx` is a TS compile error. The graph-level backstop (who-emits-what)
 * is enforced by `scripts/check-emit.ts`.
 *
 * US-013 wires the dispatcher in: after Zod validation, the registered
 * dispatcher fans out to matching rules (inserts `automation_runs` rows
 * through `ctx.tx`). The dispatcher is installed via `setDispatcher()` from
 * the automations module's `init` hook. Tests reset via
 * `__resetDispatcherForTests`.
 */

export type DispatcherFn = <E extends EventName>(name: E, payload: EventPayload<E>, ctx: { tx: Tx }) => Promise<void>

let _dispatcher: DispatcherFn | undefined

export function setDispatcher(fn: DispatcherFn): void {
  _dispatcher = fn
}

export function __resetDispatcherForTests(): void {
  _dispatcher = undefined
}

export async function emit<E extends EventName>(name: E, payload: EventPayload<E>, ctx: { tx: Tx }): Promise<void> {
  // Runtime payload validation. Compile-time check via EventPayload<E>; Zod
  // is the runtime backstop for cross-module callers that bypass typing.
  eventRegistry[name].parse(payload)
  void ctx.tx // proves the tx is in scope; dispatcher receives it below.
  if (_dispatcher) {
    await _dispatcher(name, payload, ctx)
  }
}
