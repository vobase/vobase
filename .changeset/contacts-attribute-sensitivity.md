---
"@vobase/template": minor
"create-vobase": minor
---

Per-attribute sensitivity for tenant-defined contact fields.

`contact_attribute_definitions` now carries a `sensitivity` column (`'low' | 'medium' | 'high' | 'critical'`, default `'medium'`), and the contacts module wires `resolveAttributeSensitivities()` into the change-proposal registration. When a `field_set` payload touches `attributes.<key>`, the resolver looks up the per-key sensitivity and the routing layer combines it with the resource baseline via `effectiveSensitivity()` — so tenants can mark `attributes.tax_id` as `critical` without core code changes, and proposals routing reflects it automatically.

The settings UI gets a sensitivity picker on attribute definitions; the `/changes` inbox shows the effective sensitivity that drove the routing decision.
