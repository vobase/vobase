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

Unified file tree for tenant-scoped KB and contact-scoped drive. Owns `drive.files`.

## Phase 1 real methods

- `service/files.getByPath(scope, path)` — lookup by scope-relative path
- `service/files.listFolder(scope, parentId)` — list folder contents
- `service/files.readContent(id)` — read extracted text content
- BUSINESS.md lookup with stub fallback: `"No business profile configured. Ask staff to create /BUSINESS.md in the drive."`

## Caption

`CAPTION_PROVIDER` env unset → stub returns `"[caption pending]"`.

## Spec reference

See `v2-greenfield-spec.md` §5.4 for schema, §7.4 for BUSINESS.md fallback.
