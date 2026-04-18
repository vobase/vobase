---
name: inbox
version: "1.0"
provides:
  commands:
    - inbox:list
    - inbox:get
    - inbox:resolve
    - inbox:reassign
  materializers:
    - conversationMaterializer
    - internalNotesMaterializer
permissions: []
---

# inbox module

Owns conversations, messages, internal notes, pending approvals, and channel instances.

## Phase 1 real methods

- `service/conversations.create(input)` — inserts one conversations row and returns it
- `service/pending-approvals.insert(input, tx?)` — inserts one pending_approvals row

## Spec reference

See `v2-greenfield-spec.md` §5.1 for schema.
