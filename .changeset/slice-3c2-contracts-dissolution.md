---
'@vobase/template-v2': patch
---

Dissolve `server/contracts/` and clean up transport boilerplate (slice 3c.2).

- Delete 7 dead contract files with zero external consumers: `abort-context`, `channel-adapter`, `classified-error`, `domain-types`, `iteration-budget`, `wake-context`, `threat-scan`.
- Rehome 7 live contract files to locations closer to their producers/consumers:
  - `contracts/channel-event.ts` → `server/transports/events.ts`
  - `contracts/caption-port.ts` → inlined into `modules/drive/service/caption.ts`
  - `contracts/side-load.ts` → dropped; template now imports `SideLoadContributor` / `WorkspaceMaterializer` / `SideLoadItem` directly from `@vobase/core`.
  - `contracts/scoped-db.ts` (+ test) → `server/common/scoped-db.ts`
  - `contracts/event.ts` → `server/events.ts`
  - `contracts/tool.ts` → dropped; `AgentTool` / `ToolContext` now imported from `@vobase/core`.
  - `contracts/tool-result.ts` → dropped; `ToolResult` / `OkResult` / `ErrResult` now imported from `@vobase/core`.
- Drop empty module-shape scaffold files from `server/transports/{web,whatsapp}/`: `port.ts`, `state.ts`, `schema.ts`, `seed.ts`, `service/index.ts`. Web's `jobs.ts` payload (`INBOUND_TO_WAKE_JOB`, `InboundToWakePayload`) is now inlined at its single consumer, `server/wake-handler.ts`.
- Move `server/transports/pages/index.tsx` (frontend code that violated the `server/` Vite-exclusion line) to `modules/messaging/pages-admin/channels.tsx`. URL `/channels` unchanged; `src/routes.ts` rewired accordingly.
- `ModuleDef` wrapper kept in both transports (conservative — init hooks wire instances services with real dep ordering).

No core changes required: `@vobase/core` already exported every primitive the template needed.
