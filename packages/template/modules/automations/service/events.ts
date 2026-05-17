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
 * Slice B will wire matching-rules + pg-boss fan-out. For US-004 this is a
 * skeleton: Zod-validates the payload and is a no-op for dispatch.
 */
export async function emit<E extends EventName>(name: E, payload: EventPayload<E>, ctx: { tx: Tx }): Promise<void> {
  // Runtime payload validation. Compile-time check via EventPayload<E>; Zod
  // is the runtime backstop for cross-module callers that bypass typing.
  eventRegistry[name].parse(payload)
  void ctx.tx // proves the tx is in scope; Slice B wires bridgeTxForPgBoss(tx).
  // US-013 wires the rule cache + pg-boss send here.
}
