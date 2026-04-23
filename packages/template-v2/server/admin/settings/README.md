---
name: settings
version: "1.0"
provides:
  commands:
    - settings:profile
    - settings:account
    - settings:appearance
    - settings:notifications
    - settings:display
    - settings:api-keys
permissions: []
---

# settings module

Stub module providing six POST endpoints for user preferences (profile, account, appearance, notifications, display, api-keys). All endpoints validate input with Zod and return `{ ok: true }` — persistence is deferred to a future phase per spec Criterion 23.
