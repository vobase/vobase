---
"@vobase/core": minor
---

# Template UI Overhaul: Linear-Quality Shell, AI Elements Chat, Settings & Auth Redesign

![Template UI Overhaul](https://raw.githubusercontent.com/vobase/vobase/main/.changeset/og-template-ui-overhaul-0.13.0.png)

Comprehensive frontend overhaul of the Vobase template — 90 files changed, +10,829/-1,003 lines across 20 commits. The template now ships with a Linear-quality app shell, AI Elements-powered chatbot, polished data pages, settings, and redesigned auth.

## Shell Redesign

The app shell replaces the static 260px sidebar with a full-featured navigation system:

| Feature | Description |
|---------|-------------|
| Collapsible sidebar | Icon-only mode (52px) ↔ expanded (240px), persisted in localStorage |
| Grouped nav | Sections per module (Overview, Chatbot, KB, System) with lucide icons |
| Breadcrumbs | Route-aware breadcrumbs derived from TanStack Router `useMatches()` |
| Command palette | Cmd+K fuzzy search across all pages via cmdk |
| User menu | Avatar dropdown in sidebar footer — settings, theme toggle, sign out |
| Mobile nav | Slide-in drawer with backdrop, escape-to-close, body scroll lock |
| Theme toggle | Light / Dark / System with immediate effect, persisted in localStorage |

## Chatbot UI with AI Elements + useChat

The chatbot is now powered by Vercel AI SDK's `useChat` hook and AI Elements components:

- **`useChat` + `DefaultChatTransport`** replaces manual fetch/reader/decoder streaming
- **`toUIMessageStreamResponse()`** on the backend for proper UI message protocol
- **AI Elements** components: `Conversation` (auto-scroll), `Message` + `MessageResponse` (Shiki syntax highlighting, GFM, math), `PromptInput` (auto-resize, status-aware submit), `CodeBlock`, `Shimmer` (loading indicator), `Suggestion` (quick-start chips)
- **Split-pane layout**: 280px thread sidebar + conversation area
- **Welcome screen**: greeting, assistant selector, configurable suggestion chips, inline input
- **Assistant selector**: dropdown when multiple assistants exist, suggestions update per assistant
- **`suggestions` field** on assistant schema — configurable quick-start prompts per assistant
- **Auto-title**: thread title set from first user message
- **Error toasts**: API key missing, model not found, generic failures surfaced via sonner
- **Multi-provider routing**: `claude-*` → Anthropic, `gemini-*` → Google, `gpt-*` → OpenAI

```typescript
// Backend: new /threads/:id/chat endpoint
const result = await streamChat({ db: ctx.db, assistantId, messages });
return result.toUIMessageStreamResponse();

// Frontend: useChat handles everything
const { messages, sendMessage, status } = useChat({
  transport: new DefaultChatTransport({ api: `/api/chatbot/threads/${id}/chat` }),
  messages: initialMessages,
});
```

## KB, System & Home Page Polish

| Page | Improvements |
|------|-------------|
| Audit log | Sortable DataTable with column visibility toggle, pagination |
| System ops | 4 stat cards (version, health, DB, modules) + registered modules grid |
| KB documents | File type icons, status badges, empty state with upload CTA |
| KB search | Relevance progress bars, search term highlighting, skeleton cards |
| KB sources | Status dots (green/yellow/red) with pulse animation, sync timestamps |
| Home | Stat cards + recent activity table + quick-link cards to modules |

Shared components: `PageHeader`, `StatCard`, `EmptyState` — used consistently across all pages.

## Settings Page

New `/settings` route with left nav:

- **Profile**: user info from session, name/email form
- **Appearance**: theme picker cards (Light/Dark/System) with immediate effect
- **API Keys**: placeholder UI for future key management
- **Organization**: progressive — shows only when `config.organization` is enabled

## Auth Pages Redesign

Replaced the 2-column dark panel layout with a clean centered card:

- Vobase wordmark above, copyright below
- Polished form spacing, inline error display (`bg-destructive/10`)
- Consistent login/signup styling

## Scripts & Seeding

- **`bun run reset`**: wipe `data/`, push schema, seed — one command for fresh start
- **`bun run seed`**: creates admin user + uploads real fixture files through the extraction pipeline via bunqueue (extract → chunk → embed → index)
- **Module seed files**: `modules/chatbot/seed.ts` and `modules/knowledge-base/seed.ts` with faker-generated data
- **Build script**: simplified to `tsc --noEmit` (Bun runs TypeScript directly, no bundling needed)

## Dependencies Added

| Package | Purpose |
|---------|---------|
| `@ai-sdk/react` | `useChat` hook for streaming chat UI |
| `@ai-sdk/anthropic` | Claude model support for chatbot |
| `react-markdown` | Markdown rendering (superseded by AI Elements MessageResponse) |
| `shiki` + `streamdown` | Syntax highlighting via AI Elements CodeBlock |
| `use-stick-to-bottom` | Auto-scroll for Conversation component |
| `@faker-js/faker` (dev) | Realistic seed data generation |

## Models Updated

| Context | Old | New |
|---------|-----|-----|
| Default chat model | `gpt-4o-mini` | `gpt-5-mini` |
| Seed assistants | `gpt-4o-mini` / `gpt-4o` | `gpt-5-mini` / `claude-haiku-4-5` |
| OCR model | `gemini-2.5-flash-preview-05-20` | `gemini-flash-latest` |

## Bug Fixes

- Card padding: removed redundant `pt-4/pt-5/pt-6` from CardContent across all pages
- Empty threads: filtered from sidebar, "New Chat" shows welcome screen instead of creating empty thread
- Shimmer loading: stays visible until first AI token arrives (no blank screen gap)
- Auth origin: added `localhost:5174` to `trustedOrigins`
- Seed sqlite-vec: added `setupSqliteVec()` call to seed script
- Assistant card footer: replaced heavy CardFooter with inline buttons
