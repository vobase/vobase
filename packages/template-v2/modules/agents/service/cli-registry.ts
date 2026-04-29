/**
 * Module-scoped handle on the runtime's `CliVerbRegistry`.
 *
 * The registry itself is constructed bootstrap-tier (`runtime/bootstrap.ts`)
 * and threaded into every module's `init(ctx).cli`. Most modules just call
 * `ctx.cli.registerAll([...])` — they don't need to read it back.
 *
 * The agents module DOES need to read it back: the AGENTS.md preview route
 * (`handlers/definitions.ts`) renders the same `## Commands` block the
 * agent's frozen prompt sees, which means it needs the live verb catalog at
 * request time. Every wake handler also needs it to build the in-process
 * transport. We capture it here at init time and surface it via
 * `getCliRegistry()` so callers don't have to thread the handle by hand.
 *
 * INVARIANT — load-bearing on init order. Wakes call `getCliRegistry()` only
 * after boot completes, but the registry must already contain every other
 * module's verbs by the time the agents module's `init` runs. The `requires`
 * chain (`contacts → settings → team → drive → messaging → agents`) puts
 * agents last, so when `setCliRegistry(ctx.cli)` fires, every other module
 * has already called `ctx.cli.registerAll(...)`. If anyone reorders
 * `runtime/modules.ts` and agents ends up earlier, the AGENTS.md `##
 * Commands` block silently truncates — keep agents at the end of the chain.
 */

import type { CliVerbRegistry } from '@vobase/core'

let _registry: CliVerbRegistry | null = null

export function setCliRegistry(registry: CliVerbRegistry): void {
  _registry = registry
}

export function getCliRegistry(): CliVerbRegistry {
  if (!_registry) throw new Error('CliVerbRegistry has not been installed; call setCliRegistry() in agents module init')
  return _registry
}

export function __resetCliRegistryForTests(): void {
  _registry = null
}
