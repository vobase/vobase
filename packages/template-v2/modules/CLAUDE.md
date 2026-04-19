## modules/

Six modules, all conforming to the same `defineModule` shape (enforced by `check:shape`). Opening `modules/inbox/` should show the same layout as `modules/drive/`; adding a new channel or business domain is a drop-in folder, not a multi-file patch.

**Required files per module** (any missing = `check:shape` fails): `module.ts`, `manifest.ts`, `schema.ts`, `handlers/index.ts`, `port.ts`, `README.md`. Handler files ≤ 200 raw lines (lift into `service/`). No cross-module `schema.ts` imports. `applyTransition()` only in `state.ts`.

**Init order (enforced via `requires`):** `contacts → drive → inbox → agents → channel-web → channel-whatsapp`. Later modules depend on earlier-module ports through `PluginContext.ports`.

**One-write-path.** Every mutation to a domain table lives in one place — the module's `service/` layer, inside a transaction that also appends to `conversation_events`. No handlers, no jobs, no tools mutate tables directly. Kills the dual-write problem and the god-module problem.

**Naming convention** (taste, not CI): plural for entity-collection modules (`agents`, `contacts`); singular for places/adapters (`inbox`, `drive`, `channel-web`, `channel-whatsapp`).
