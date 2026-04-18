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

## Spec reference

See `v2-greenfield-spec.md` §5.2 for schema.
