---
name: messaging
version: "1.0"
provides:
  commands:
    - messaging:list
    - messaging:get
    - messaging:resolve
    - messaging:reassign
  materializers:
    - conversationMaterializer
    - internalNotesMaterializer
permissions: []
---

# messaging module

Owns conversations, messages, internal notes, pending approvals, and channel instances.

## Phase 1 real methods

- `service/conversations.create(input)` — inserts one conversations row and returns it
- `service/pending-approvals.insert(input, tx?)` — inserts one pending_approvals row

## Schema

See `schema.ts` for the full Drizzle schema (messaging module tables live in the `messaging` pgSchema).
