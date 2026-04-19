## server/contracts/

The scannable API surface. No business logic — only types, interfaces, and one compile-only exhaustiveness check. Three hard rules:

**R1 — Hand-written domain types.** `domain-types.ts` shapes are hand-written, never `InferSelectModel<typeof schema>`. Otherwise a schema change in one module silently mutates types in another.

**R2 — Shared module-shape constants.** `module-shape.ts` is imported by both `server/runtime/define-module.ts` (boot-time enforcement) and `scripts/check-module-shape.ts` (CI lint). Single source; never duplicate the required-files list.

**R3 — Compile-only exhaustiveness gate.** `__checks__/integration.ts` `switch`es over every `AgentEvent` variant. Adding a new variant without handling it here breaks `tsc`. This is how observers/mutators can't silently miss a new event type.

**Port rule.** Cross-module access goes through `<name>-port.ts` surfaced via `PluginContext.ports`. Direct cross-module `schema.ts` imports are forbidden (enforced by `check:shape`). Add a port: define interface → implement in `modules/<name>/port.ts` → wire into `PluginContext.ports` → wire into `plugin-context-factory.ts`.

**Outbound tool coupling.** `OUTBOUND_TOOL_NAMES` in `channel-event.ts` is authoritative. Every name here must also appear in the switches in `modules/channel-web/service/dispatcher.ts` AND `modules/channel-whatsapp/service/sender.ts` — otherwise outbound delivery silently drops.
