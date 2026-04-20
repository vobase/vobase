---
name: drive
version: "1.0"
provides:
  commands:
    - drive:ls
    - drive:cat
    - drive:grep
    - drive:find
  materializers:
    - businessMdMaterializer
    - driveFolderMaterializer
permissions: []
---

# drive module

Unified file tree for organization-scoped KB and contact-scoped drive. Owns `drive.files`.

## Phase 1 real methods

- `service/files.getByPath(scope, path)` — lookup by scope-relative path
- `service/files.listFolder(scope, parentId)` — list folder contents
- `service/files.readContent(id)` — read extracted text content
- BUSINESS.md lookup with stub fallback: `"No business profile configured. Ask staff to create /BUSINESS.md in the drive."`

## Caption

`CAPTION_PROVIDER` env unset → stub returns `"[caption pending]"`.

## Schema

See `schema.ts` for the full Drizzle schema (drive module tables live in the `drive` pgSchema). The BUSINESS.md fallback stub lives in `server/workspace/create-workspace.ts`.
