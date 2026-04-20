---
name: system
version: "1.0"
provides:
  commands:
    - system:health
    - system:audit-log
    - system:sequences
permissions: []
---

# system module

Ops-level endpoints for runtime introspection. Exposes `GET /` (version, uptime, active module names), `GET /audit-log` (cursor-paginated view of the `_audit_log` built-in table managed by `@vobase/core`), and `GET /sequences` (all sequence counters from the `_sequences` built-in table). No domain tables — all persistence is delegated to `@vobase/core` built-ins.
