## modules/

Eight modules total — six business-domain modules plus two channel adapters grouped under `channels/`. All conform to the same `defineModule` shape (enforced by `check:shape`). Opening `modules/inbox/` shows the same layout as `modules/drive/`; adding a new channel or business domain is a drop-in folder, not a multi-file patch.

**Required files per module** (any missing = `check:shape` fails): `module.ts`, `manifest.ts`, `schema.ts`, `state.ts`, `service/index.ts`, `handlers/index.ts`, `jobs.ts`, `seed.ts`, `README.md`. Handler files ≤ 200 raw lines (lift into `service/`). `applyTransition()` only in `state.ts`.

Domain modules do not ship `port.ts` — callers go straight to `@modules/<name>/service/*`. The four domain port interfaces (`inbox-port.ts`, `agents-port.ts`, `contacts-port.ts`, `drive-port.ts` in `server/contracts/`) exist as the TYPE surface for `PluginContext.ports.{inbox,agents,contacts,drive}`, wired by `server/dev/dev-ports.ts`. Channel adapters (`channels/web`, `channels/whatsapp`) own a `port.ts` because `V2ChannelAdapter` has multiple real implementations.

**Init order (enforced via `requires`):** `contacts → drive → inbox → agents → channels/web → channels/whatsapp`. Later modules depend on earlier-module ports through `PluginContext.ports`.

**One-write-path.** Every mutation to a domain table lives in one place — the module's `service/` layer, inside a transaction that also appends to `conversation_events`. No handlers, no jobs, no tools mutate tables directly. Kills the dual-write problem and the god-module problem.

**Naming convention** (taste, not CI): plural for entity-collection modules (`agents`, `contacts`); singular for places/adapters (`inbox`, `drive`). Channel adapters live under `channels/` (see `channels/CLAUDE.md`) — the grouping signals they sit behind a contract, not a business surface.
