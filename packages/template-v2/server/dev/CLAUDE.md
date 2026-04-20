## server/dev/

Dev-only bootstrap. Nothing in this folder runs when `NODE_ENV === 'production'`.

**`dev-ports.ts`** — synthesizes `InboxPort` / `ContactsPort` / `AgentsPort` / `DrivePort` / `RealtimeService` directly against drizzle + the existing service layer, plus an in-process `jobs` queue that fires handlers via `Promise.resolve().then(...)`. Production replaces the ports with the pg-boss-backed wake harness; the service-layer write paths stay identical so the one-write-path invariant holds.

**`stub-agent.ts` / `live-agent.ts`** — job handlers bound to `channel-web:inbound-to-wake`. `stub-agent` replies with canned text/card fixtures (pricing, refund, help, greeting) so the web channel can be exercised end-to-end without any LLM key. `live-agent` routes through the real Anthropic provider via `bootWake`; selection happens in `server/app.ts` based on `ANTHROPIC_API_KEY` presence.

**Why this folder exists, separately from `server/runtime/`.** `runtime/` is framework primitives (module boot, event/mutator/observer buses, LLM chokepoint, state transitions) that ship in every environment. `dev/` is app-level composition that happens to target local dev — it composes `runtime/` primitives into a harness. If `live-agent` ever graduates to a real pg-boss-backed wake worker, it moves out.

**Don't import from here outside `server/app.ts`.** These files assume a single-process, fire-and-forget job model that isn't safe in production. The bundle-safety check (`check:bundle`) should keep `src/**` out; modules should never reach for `@server/dev/*` either.
