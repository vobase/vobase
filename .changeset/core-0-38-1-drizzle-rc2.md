---
"@vobase/core": patch
---

Bump drizzle-kit + drizzle-orm peer/dev deps to `1.0.0-rc.2` (from `^1.0.0-beta.21` / `1.0.0-beta.23`). Adjust `MessageHistoryDb` to use the default `EmptyRelations` type-param so it satisfies rc.2's tightened `AnyRelations` constraint while staying backward-compatible with beta.21 callers.

Slice 1.5.5 (companion to vobase-platform's Slice 1.5 drift cleanup): closes the rc.2 incompat that surfaced when platform bumped its own drizzle-kit/orm to rc.2.

Follow-up not in this slice: change `nanoidPrimaryKey()`'s default from `NANOID_LENGTH.DEFAULT` (8) to `NANOID_LENGTH.LONG` (12). That eliminates the 7-ALTER residual platform's `check:snapshot-drift` allowlists today.
