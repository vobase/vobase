## server/dev/

Dev-only bootstrap. Nothing in this folder runs when `NODE_ENV === 'production'`.

**`dev-ports.ts`** — synthesizes `InboxPort` / `ContactsService` / `AgentsPort` / `FilesService` / `RealtimeService` directly against drizzle + the existing service layer, plus an in-process `jobs` queue that fires handlers via `Promise.resolve().then(...)`. Production replaces the ports with the pg-boss-backed wake harness; the service-layer write paths stay identical so the one-write-path invariant holds. `RealtimeService` is a thin wrapper around `@vobase/core`'s `createRealtimeService` (singleton LISTEN on `vobase_events` + in-memory subscriber fanout); `notify` is sync-void per the contract.

**`stub-agent.ts` / `live-agent.ts`** — job handlers bound to `channel-web:inbound-to-wake`. `stub-agent` replies with canned text/card fixtures (pricing, refund, help, greeting) so the web channel can be exercised end-to-end without any LLM key. `live-agent` routes through `bootWake` on top of `@mariozechner/pi-agent-core`. Key selection happens in `server/app.ts`: live path is picked when `OPENAI_API_KEY` is set OR when both `BIFROST_API_KEY` + `BIFROST_URL` are set (Bifrost is the prod OpenAI-compatible gateway). With neither, the stub path runs.

**Why this folder exists, separately from `server/runtime/`.** `runtime/` is framework primitives (module boot, event/mutator/observer buses, LLM chokepoint, state transitions) that ship in every environment. `dev/` is app-level composition that happens to target local dev — it composes `runtime/` primitives into a harness. If `live-agent` ever graduates to a real pg-boss-backed wake worker, it moves out.

**Don't import from here outside `server/app.ts`.** These files assume a single-process, fire-and-forget job model that isn't safe in production. The bundle-safety check (`check:bundle`) should keep `src/**` out; modules should never reach for `@server/dev/*` either.
