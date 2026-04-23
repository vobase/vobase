## modules/

Eight registered modules (see `vobase.config.ts`): `settings, contacts, team, drive, messaging, agents`, plus two channel adapters grouped under `channels/` (`web`, `whatsapp`). All conform to the same `defineModule` shape — enforced by `check:shape`. Adding a new channel or business domain is a drop-in folder, not a multi-file patch. (`modules/system/` is legacy scaffolding not in the registry; `modules/tests/` holds cross-module integration tests.)

**Required files per module** (any missing = `check:shape` fails): `module.ts`, `manifest.ts`, `schema.ts`, `state.ts`, `service/index.ts`, `handlers/index.ts`, `jobs.ts`, `seed.ts`, `README.md`. Handler files ≤ 200 raw lines (lift into `service/`). `applyTransition()` only in `state.ts`.

Domain modules do not ship `port.ts` — callers go straight to `@modules/<name>/service/*`. Domain entity types (`Conversation`, `Message`, `Contact`, `DriveFile`, `StaffProfile`, etc.) live in each module's `schema.ts`. Service interface types (`MessagingPort`, `AgentsPort`) live in `service/types.ts`; `FilesService` and `ContactsService` are exported from `service/files.ts` / `service/contacts.ts` directly. Channel adapters (`channels/web`, `channels/whatsapp`) own a `port.ts` because `V2ChannelAdapter` has multiple real implementations.

**Init order (enforced via `requires`):** `settings → contacts → team → drive → messaging → agents → channels/web → channels/whatsapp`. Later modules depend on earlier-module services through direct `@modules/<name>/service/*` imports (and `PluginContext.ports` inside the wake harness).

**One-write-path.** Every mutation to a domain table lives in one place — the module's `service/` layer, inside a transaction that also appends to `conversation_events`. No handlers, no jobs, no tools mutate tables directly. Kills the dual-write and god-module problems.

**Module layout on disk.** Backend + frontend straddle in the same module. Backend: `schema.ts`, `service/`, `handlers/`, `jobs.ts`, `state.ts`, `seed.ts`, `module.ts`, `manifest.ts`. Frontend (when the module owns UI): `pages/`, `components/`, `api/` (TanStack Query hooks calling `/api/<module>/*`), optional `skills/` (agent skill markdown). Module-specific hooks/components never move up to `src/` — see `src/CLAUDE.md` for the test.

**Naming convention** (taste, not CI): plural for entity-collection modules (`agents`, `contacts`); singular for places/adapters (`messaging`, `drive`). Channel adapters live under `channels/` — the grouping signals they sit behind a contract, not a business surface.
