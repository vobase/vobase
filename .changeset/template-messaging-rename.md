---
'@vobase/template-v2': minor
---

Rename `inbox` → `messaging` across template-v2. Affects:

- Module directory: `modules/inbox/` → `modules/messaging/`.
- Postgres schema: `pgSchema('inbox')` → `pgSchema('messaging')` (same tables: `conversations`, `messages`, `channel_instances`, `internal_notes`, `pending_approvals`, `mention_dismissals`); TS export `inboxPgSchema` → `messagingPgSchema`.
- Cross-schema FK targets in `db-apply-extras.ts` updated: `messaging.conversations.contact_id → contacts.contacts(id)`, `contacts.staff_channel_bindings.channel_instance_id → messaging.channel_instances(id)`, `drive.files.source_message_id → messaging.messages(id)`.
- All `@modules/inbox/*` imports and all `inbox.*` SQL references.
- Module name string `'inbox'` → `'messaging'` (module registration + `requires` arrays + health route); API mount `/api/inbox` → `/api/messaging`; frontend route `/inbox` → `/messaging`; `pg-boss` queue key `inbox:wake-snoozed` → `messaging:wake-snoozed`.
- Exported symbols renamed: `InboxPort` → `MessagingPort`, `InboxTab` → `MessagingTab`, `inboxTools` → `messagingTools`, `inboxApp` / `inboxClient` → `messagingApp` / `messagingClient`, `seedInbox` → `seedMessaging`, `buildInboxPort` → `buildMessagingPort`, `listInboxByContact` → `listMessagingByContact`.
- UI/copy: `"Inbox"` nav label + `<title>` → `"Messaging"`; `InboxLayout` / `InboxEmptyState` / `GroupedInbox` / `fetchInboxGrouped` renamed accordingly; lucide `Inbox` icon kept, aliased as `MessagingIcon`.
- CI guard (`check-module-shape.ts`) journal write-path whitelist scoped to `modules/messaging/service/`.

No shim, no alias — every reference flipped in the same commit. Single-codebase rename.
