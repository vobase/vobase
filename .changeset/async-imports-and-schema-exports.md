---
"@vobase/core": minor
---

Make createApp async to support dynamic imports of bunqueue and MCP SDK.
Export auth schema tables from core index for direct drizzle-kit usage.
Fix storage download route Uint8Array → ArrayBuffer for Bun compat.
Switch package exports to source-first (no dist build required).
