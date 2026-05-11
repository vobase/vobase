---
"@vobase/template": patch
---

# Fix reactions test to use a real message_id

`modules/messaging/service/reactions.test.ts` asserted "onConflictDoNothing absorbs missing FK" against a synthetic message id — but the reactions FK is now same-schema (`messaging.message_reactions.message_id → messaging.messages.id`) and enforced by drizzle's normal `db:push`, so Postgres raises `23503` foreign_key_violation before any ON CONFLICT evaluation. The original test comment claimed the FK was cross-schema and enforced post-push only; that assumption no longer holds at HEAD.

Update the test to insert a synthetic message under the seeded conversation in `beforeAll`, then assert idempotency and `removeReaction` no-op behaviour against a valid FK target. Greens both `upsertReaction` tests.

Resolves #68.
