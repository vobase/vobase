---
"@vobase/core": patch
---

# AI-Native Messaging: Multi-Channel Agent + Conversations Workspace

![Multi-Channel Agent](https://raw.githubusercontent.com/nicepkg/vobase/main/.changeset/og-multi-channel-agent-v0.12.0.png)

## Overview

Complete overhaul of the messaging architecture — from ticket-based agents to an AI-native conversations workspace. The template now ships a booking agent with multi-channel support, a consolidated conversations module, production-grade reliability, and rich data tables with server-side filtering.

---

## AI-Native Inbox Redesign

Replaced the old ticket-based messaging module with a purpose-built conversations system:

- **Booking agent** with tools: check-availability, book-slot, cancel-booking, reschedule, send-reminder, consult-human
- **Session lifecycle workflow** for managing booking conversations end-to-end
- **Contacts module** for customer/staff directory (later consolidated into conversations)
- **Dashboard module** for agent control plane and session monitoring (later consolidated into conversations)
- Removed old assistant/quick-helper agents, ticket management tools, and escalation workflows

## Consolidated Conversations Workspace

All messaging functionality absorbed into a single `conversations` module:

- **Contacts** merged into conversations (shared `conversationsPgSchema`, AD-3 pattern)
- **Dashboard pages** moved to `conversations/pages/sessions`
- **AI pages** (agents, evals, guardrails, memory) moved under `conversations/pages/ai`
- **Channels page** added for endpoint/channel instance management
- Navigation restructured: Conversations > Sessions, Contacts, Channels, AI
- Chat endpoint renamed from `inboxId` to `endpointId`

## Multi-Channel Agent

The same Mastra Agent handles multiple channels (WhatsApp, Web, future IM) with channel-native structured responses using chat-sdk's `CardElement` as the universal format.

### sendCard Tool + Channel Constraints

New Mastra tool with a flat, LLM-friendly schema that validates against per-channel constraints:

| Channel | Max Buttons | Max Label | Max Body | Markdown |
|---------|-------------|-----------|----------|----------|
| WhatsApp | 3 | 20 chars | 1024 chars | No |
| Web | Unlimited | 100 chars | 10,000 chars | Yes |
| Telegram (stub) | 8 | 64 chars | 4,096 chars | Yes |

The tool validates at call time and returns actionable error strings — the agent self-corrects via `maxSteps` retry.

### Channel Context Injection

`RequestContext` from `@mastra/core/request-context` passed to `agent.generate()` and `agent.stream()` with channel type, conversation ID, and contact ID. Fixes a latent bug where memory/moderation processors didn't fire for channel sessions.

### CardElement Extraction Pipeline

`extractSendCardResults()` inspects `response.steps` for `send_card` tool results via Mastra's `ToolResultChunk.payload` shape, routes each `CardElement` through the existing `serializeCard()` → outbox pipeline. Zero changes needed to WhatsApp serialization.

### CardRenderer Component

New ai-elements component maps `CardElement` to shadcn/ui with single-use buttons (disable after click), `readOnly` mode for admin, and graceful fallback for unknown element types.

### Chat Page Cleanup

`chat.$endpointId.tsx` refactored from ~370 to ~120 lines — extracted `usePublicChat` hook, `MessagePartsRenderer`, `ThinkingMessage`, and `ToolCallPart` as shared components.

## Production Hardening

- **Dead letter queue** — terminal outbox message store after max retries
- **Outbox retry** with exponential backoff (2s → 32s, max 5 retries)
- **Circuit breaker** per channel type (5 failure threshold, 60s open)
- **Atomic contact upsert** with `ON CONFLICT (phone) DO UPDATE`
- **Session degrade-and-retry** on Mastra Memory thread failure
- **Atomic consultation transitions** (`WHERE status='pending'` guards)
- **Agent fallback message** on `generate()` failure
- **Structured logging** with timing for all major operations
- **Composite/partial indexes** for outbox, sessions, consultations
- Split monolithic `handlers.ts` into `handlers/` directory

## Admin Session View

- **Channel badge** (WhatsApp/Web) on session header
- **Delivery status** (queued/sent/delivered/read/failed) with color coding
- **CardRenderer readOnly** for send_card tool calls in transcript
- **Staff reply** saves to Mastra Memory, shown with blue label
- **Visitor label** shows contact name instead of generic "Contact"
- **Prose-sm typography** — compact markdown rendering

## Data Tables with Server-Side Filtering

Installed `data-table-filters` registry blocks with full server-side filtering pipeline:

- **Sessions table** — status/agent checkbox filters, timerange on startedAt, View/Pause/Retry actions
- **Contacts table** — role checkbox filter, name input filter, clickable detail links
- **Backend** — `createDrizzleHandler` for cursor pagination, faceted filtering, 3-pass filter strategy
- **Frontend** — `useInfiniteQuery` with server-driven facets, sortable columns, infinite scroll

## Realistic Seed Data

Faker-generated demo data with deterministic seed (42):

- 48 contacts (customers, leads, staff) with SG phone numbers
- 3 channel instances (WhatsApp Business, Web Chat, sandbox)
- 80 sessions across all lifecycle states over 30 days
- 299 outbox messages, 11 consultations, 5 dead letters

## Core: Webhook Hardening (patch)

- Webhook JSON validation (400 on invalid JSON, 422 on wrong shape)
- In-memory rate limiter for webhook endpoints (100 req/s/IP)
- WhatsApp media size pre-check (25MB limit)
- Webhook error classification (`adapter_parse_error` vs `event_processing_error`)
- Platform signature edge case logging

## Codebase Quality

- Fixed all type errors (10 → 0) and lint errors (31 → 0)
- Explicit virtual route definitions for conversations sub-layouts
- Regenerated `routeTree.gen.ts` with correct hierarchy
- 22+ files auto-fixed for import ordering
- Updated shadcn UI components after registry update

## Test Coverage

| Area | Tests |
|------|-------|
| send-card tool | 9 |
| channel-constraints | 7 |
| channel-reply extraction | 9 |
| CardRenderer component | 10 |
| Production hardening (12 files) | 206 |
| **Total new tests** | **241** |
