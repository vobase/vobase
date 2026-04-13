---
"@vobase/core": patch
---

Add connection pool tuning for cloud-hosted PostgreSQL (Neon). Configure idle timeout, max lifetime, and connection timeout on bun:sql; explicit pool size on pg-boss; increased connect timeout on realtime LISTEN connection.
