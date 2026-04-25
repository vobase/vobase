---
'@vobase/core': minor
'@vobase/template-v2': minor
---

Slice 4b: declarative module collector.

Each module now declares its agent-facing surfaces (`tools`, `materializers`,
`listeners`, `commands`, `sideLoad`, `web.routes`, `jobs`) in sibling files
(`module.ts` aggregator + `web.ts` + `agent.ts` + `materializers.ts` +
`jobs.ts`). `server/app.ts` collects these once at boot via three core
collectors (`collectAgentContributions`, `collectWebRoutes`, `collectJobs`)
and passes the bundle to the wake handler.

Net-new behaviour:
- `sendFileTool` and `bookSlotTool` reach the harness for the first time
  (previously declared, never wired). Tool surface becomes
  `[reply, send_card, send_file, book_slot, subagent]`.
- `messaging:wake-snoozed` job now binds to pg-boss — snooze expiry actually
  re-wakes the agent instead of silently dropping.

API changes:
- `@vobase/core` exports `createWorkspace` (domain-free) — template's
  `server/workspace/create-workspace.ts` becomes a thin helpdesk wrapper
  that adds lazy drive/skills mounts on top of the core factory.
- The legacy `ModuleDef.routes?` top-level field is removed in favor of
  `ModuleDef.web?.routes`. All template modules updated.
- `systemHash` shifts once due to the broadened messaging tool surface in
  the frozen prompt.
