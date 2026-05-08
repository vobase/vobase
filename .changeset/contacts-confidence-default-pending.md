---
"@vobase/template": patch
"create-vobase": patch
---

`vobase contacts propose-change`: route high-sensitivity fields to `pending` and stop leaking cross-account uniqueness.

**Confidence default depends on principal.** Agent-origin calls without an explicit `--confidence` now default to `0.85` (was `1.0`). With `T_AUTO_BASE=0.7` + `LEVEL_HIGH=0.7` + `HEADROOM=0.3`, the high auto-bar is `0.91`, so `0.85` routes high-sensitivity fields (`email`, `phone`, `displayName`) to `pending` for staff review while leaving low/medium fields auto-applying. Manual CLI calls (`apikey`/`user` principal) keep the `1.0` default — explicit operator decisions still auto-apply unless the resource is `critical`. Agents can bypass review by passing `--confidence 0.95` when a learned skill or staff memory authorizes direct writes.

**Unique-violation (`23505`) is now neutral.** The verb's response no longer echoes `pg.detail` (which contained the conflicting row's value, leaking that another customer in the org owns it). The error reads `"That value cannot be set on this contact. Ask the customer to verify or provide a different one."`, and the verb prompt explicitly tells the agent to treat the conflict as confidential.

Verb prompt updated: `pending` example phrasing now lists `phone` alongside `displayName`/`email` and forbids `"done/updated/all set"` replies; `auto_applied` example shifted to `segments`.
