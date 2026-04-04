---
"@vobase/core": patch
---

Graceful fallback when pg-boss fails to start (e.g. stale schema). Returns a no-op scheduler that logs warnings instead of crashing the app. Also catches errors inside `schedule()` to prevent unhandled rejections from synchronous `init()` hooks.
