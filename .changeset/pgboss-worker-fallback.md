---
"@vobase/core": patch
---

Graceful fallback for job worker when pg-boss fails to start. Returns a no-op worker so the app boots without job processing instead of crashing.
