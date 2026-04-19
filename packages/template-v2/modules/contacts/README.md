---
name: contacts
version: "1.0"
provides:
  commands:
    - contacts:get
    - contacts:list
    - contacts:search
  materializers:
    - contactProfileMaterializer
    - contactMemoryMaterializer
permissions: []
---

# contacts module

Owns tenant-scoped contact identity: phone/email lookup, working memory, segments, staff channel bindings.

## Phase 1 real methods

- `service/contacts.get(id)` — fetch contact by id
- `service/contacts.upsertByExternal(input)` — upsert by phone or email
- `service/contacts.resolveStaffByExternal(channelInstanceId, externalIdentifier)` — staff binding lookup

## Schema

See `schema.ts` for the full Drizzle schema (contacts module tables live in the `contacts` pgSchema).
