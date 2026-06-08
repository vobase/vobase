---
"@vobase/template": minor
---

# WhatsApp coexistence chat-history import

When a business connects via WhatsApp coexistence, Meta can deliver up to 180 days of prior on-phone conversation history. The inbox now imports that history as resolved conversations, so the agent and staff have full customer context from day one instead of an empty inbox.

New schema (a DB push/migrate is required when upgrading a scaffold):

| Table | Purpose |
| --- | --- |
| `channels.whatsapp_history_chunks` | Durable single-writer staging for each `field:"history"` webhook chunk, UNIQUE on `(channel_instance, phase, chunk_order)` so redelivery is idempotent; drained asynchronously |

What ships with it:

- **Sync request** — `meta-oauth.syncSmbAppData` requests history + contacts sync after onboarding (wired from the signup finish and the setup job). `POST /finish/:instanceId` accepts `{ resync: ["history"] }` to re-request when Meta accepts the request but never delivers the burst.
- **Staging + drain** — the `field:"history"` webhook is intercepted and each chunk staged in `whatsapp_history_chunks`; `jobs/history-drain.ts` drains in bounded passes, `parse-history.ts` turns each chunk into messages (with a digits-only business-vs-customer direction check), and `conversations.backfillHistoricalMessages` writes them in batches inside one transaction per thread.
- **Media + naming** — `jobs/history-media.ts` downloads and attaches history media; the contacts-sync webhook names imported contacts instead of leaving them phone-only.
- **Resolution** — `conversations.resolveImportedHistory` closes pure-history threads in bounded id-batches once a thread's chunks are fully drained. Business-App-sent history messages are labelled distinctly and attributed to Staff in the thread.
- **Auditability** — backfill emits one `conversation.history_imported` event per imported conversation and resolve emits one `conversation.history_resolved`, both idempotent on re-drain and rendered as single timeline activity rows.

Also: contacts with no display name (e.g. a phone-only history-backfill contact) now render as their email/phone in the principal directory rather than the opaque id.
