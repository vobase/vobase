## server/contracts/

The scannable API surface. No business logic — only types, interfaces, and one compile-only exhaustiveness check. Two hard rules:

**R1 — Shared module-shape constants.** `module-shape.ts` is imported by both `server/runtime/define-module.ts` (boot-time enforcement) and `scripts/check-module-shape.ts` (CI lint). Single source; never duplicate the required-files list.

**R2 — Compile-only exhaustiveness gate.** `__checks__/integration.ts` `switch`es over every `AgentEvent` variant. Adding a new variant without handling it here breaks `tsc`. This is how observers/mutators can't silently miss a new event type.

**Journal write-path guard.** `checkJournalWriteAuthority` in `scripts/check-module-shape.ts` greps for `.insert|update|delete(messages|conversationEvents …)` and fails unless the file lives under `modules/inbox/service/**` or is `modules/agents/service/journal.ts`. Guards the one-write-path tables only; other schema imports are fine.

**Cross-module access.** Import the service directly: `import { appendTextMessage } from '@modules/inbox/service/messages'`. The four domain "port" interfaces (`inbox-port.ts`, `agents-port.ts`, `contacts-port.ts`, `drive-port.ts`) are the TYPE surface for `PluginContext.ports.{inbox,agents,contacts,drive}`, wired by `server/dev/dev-ports.ts` for dev + test — treat them as the wiring contract, not a facade.

**Outbound tool coupling.** `OUTBOUND_TOOL_NAMES` in `channel-event.ts` is authoritative. Every name here must also appear in the switches in `modules/channel-web/service/dispatcher.ts` AND `modules/channel-whatsapp/service/sender.ts` — otherwise outbound delivery silently drops.
