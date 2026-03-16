---
"@vobase/core": minor
---

# Channels, Messaging & Type Safety

![Channels & Messaging](https://raw.githubusercontent.com/vobase/vobase/main/.changeset/og-channels-messaging-v0.14.png)

## Channels Module (Core)

New built-in `_channels` module provides a unified multi-channel messaging infrastructure with pluggable adapters.

### Channel Adapters

| Adapter | Transport | Features |
|---------|-----------|----------|
| **WhatsApp** | Cloud API v22.0 | Text, image, document, audio, video, sticker, location, contacts, interactive (buttons/lists), reactions, status updates, media download/upload, message chunking (4096 char limit), signature verification, error code mapping |
| **Resend** | REST API | HTML email via Resend |
| **SMTP** | nodemailer | HTML email via SMTP relay |

### Contracts

- `ChannelAdapter` — pluggable adapter interface (`send`, `parseWebhook`)
- `ChannelEvent` — discriminated union: `MessageReceivedEvent | StatusUpdateEvent | ReactionEvent`
- `ChannelsService` — adapter registry with `registerAdapter()`, `send()`, `parseWebhook()`, event bus
- `ChannelEventEmitter` — typed event emitter for `message_received`, `status_update`, `reaction`

### WhatsApp Adapter Details

- Full Embedded Signup flow (code exchange, WABA/phone resolution, webhook subscription)
- Media handling: downloads WhatsApp-hosted media (URLs expire in ~5 min), uploads via `form-data`
- Message chunking: splits long messages at sentence boundaries respecting the 4096 char API limit
- Error mapping: WhatsApp error codes mapped to structured `WhatsAppApiError` with `retryable` flag
- Signature verification: HMAC-SHA256 validation of webhook payloads
- 65 unit tests covering all message types, status updates, reactions, error scenarios

## Integrations Module (Core)

New built-in `_integrations` module provides encrypted credential storage for external service connections.

- `IntegrationsService` — connect, disconnect, get active integration, update config
- AES-256-GCM encryption for credentials at rest (access tokens, app secrets)
- Schema: `_integrations` table with provider, status, encrypted credentials, config metadata
- Designed for OAuth flows where tokens need secure persistence

## Messaging Module (Template)

New `messaging` module replaces the previous `chatbot` module with full multi-channel support.

### Architecture

- **Agents**: Configurable AI agents with model selection, system prompts, tools, KB integration, and channel assignment
- **Threads**: Conversations between users/contacts and agents, scoped by channel (web, whatsapp)
- **Contacts**: External contact management (phone, email, name, channel)
- **Messages**: Bidirectional message store with direction (inbound/outbound), sender type (user/agent/contact/staff), AI role tracking

### Channel Handler Pipeline

1. Inbound message received via webhook
2. Find or create contact from sender identity
3. Find or create thread (contact + channel + agent)
4. Upload media attachments to storage (WhatsApp URLs expire)
5. Store message with attachment metadata
6. If thread status is `ai`, queue debounced reply (3s batching)
7. AI agent processes conversation, streams response
8. Outbound message queued via outbox pattern

### Additional Features

- Staff-sent detection: messages sent from WhatsApp Business App pause AI and set resume to next 9am
- Thread status machine: `ai` | `human` | `paused` with manual resume endpoint
- Outbound message queue with delivery status tracking
- AI escalation detection via tool calling
- Zod validation on all 7 POST/PUT handlers

## Integrations Module (Template)

New `integrations` module handles WhatsApp Embedded Signup OAuth flow.

- Frontend: Facebook SDK lazy loading, popup-based OAuth, real-time webhook status polling
- Backend: Code exchange, WABA/phone number resolution, credential storage, adapter hot-reload
- Post-signup job: webhook subscription, callback URL registration, phone number registration (with retry)
- Uses Hono typed RPC client + TanStack Query (no raw fetch)

## Data Table System

Replaced the previous data-grid with a faceted filter data table system.

### Components

- `DataTableInfinite` — virtualized infinite-scroll table with TanStack Table
- Filter controls: checkbox, input, slider, timerange with drawer layout
- Cell renderers: badge, boolean, code, number, text, timestamp
- Store sync: integrates with URL search params via `nuqs`
- Provider pattern for table state management

### Table Schema DSL

Type-safe schema definition for data tables:

- `col()` builder with chainable methods: `.text()`, `.number()`, `.boolean()`, `.date()`, `.enum()`, `.badge()`
- Auto-generates: TanStack columns, filter fields, filter schema, sheet fields
- Serialization layer for URL-safe filter state
- Preset system for common column patterns (id, timestamps, status, email)

## Type Safety & Quality Pass

### Eliminated `as any` (30+ instances)

**Core production code:**
- `mcp/crud.ts` — `ColumnMeta` interface for Drizzle column introspection, `Record<string, unknown>` for dynamic values, `catch (e: unknown)` with proper narrowing
- `auth/index.ts` — `BetterAuthPlugin[]` typed array, `AuthApiWithVerifyApiKey` interface for API key verification

**Core tests:**
- `whatsapp.test.ts` — 22 casts replaced with `MessageReceivedEvent`, `StatusUpdateEvent`, `ReactionEvent`
- `crud.test.ts` — `McpServerInternals` interface for MCP SDK internals
- `permissions.test.ts` — proper `AuthUser` type
- `drizzle-introspection.test.ts` — `ColumnMeta` interface

**Template:**
- `threads.tsx` — `TextUIPart` type predicate for AI message parts
- `handlers.ts` — `UIMessage[]` typing, `TextUIPart` filter
- `channel-handler.ts` — direct `event.messageType` access

### Raw SQL to Drizzle

- `next-sequence.ts` — replaced `db.$client.prepare()` with `insert().onConflictDoUpdate().returning()`

### ZodError Global Handler

- `errors.ts` — Zod validation errors now return 400 with `err.flatten()` details instead of generic 500

### Bug Fixes

- **API key auth was silently broken**: `verifyApiKey` accessed `result.key.userId` which doesn't exist on the `ApiKey` type — fixed to use `result.key.referenceId`
- **Thread data leak**: `GET /threads` returned all threads regardless of user — fixed to filter by `ctx.user.id`
- **Thread access control**: `GET /threads/:id` allowed reading any thread — fixed to check ownership

## UI Updates

- Refreshed shadcn/ui components (base-nova preset)
- Updated shell: collapsible sidebar, breadcrumbs, command palette, mobile nav
- Settings page: integrations tab with WhatsApp connect/disconnect/test
- System logs page: faceted data table with audit log entries
- Knowledge base connectors: Google Drive and SharePoint OAuth flows

## Dependencies

| Package | Purpose |
|---------|---------|
| `@anthropic-ai/sdk` | Claude model provider |
| `@better-auth/api-key` | API key authentication plugin |
| `nodemailer` | SMTP email transport |
| `@diceui/sortable` | Drag-and-drop sortable lists |
| `nuqs` | URL search param state management |

## Test Coverage

- Core: 277 tests across 28 files (all pass)
- Template: 93 tests across 10 files (68 pass, 25 pre-existing KB/sqlite-vec failures)
- WhatsApp adapter: 65 tests covering all message types and error scenarios
- Messaging handlers: 16 tests covering CRUD, chat, ownership
