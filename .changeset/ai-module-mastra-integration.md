---
"@vobase/core": minor
"create-vobase": patch
---

# AI Module: Mastra Integration & Memory Pipeline

![AI Module](https://raw.githubusercontent.com/vobase/vobase/main/.changeset/og-ai-module-0.20.0.png)

## Mastra Agent Architecture

Replaced the database-driven agent factory pattern with static Mastra `Agent` instances using dynamic processors. Agents are now defined as code-level singletons with runtime-resolved input/output processors for moderation and memory.

| Component | What Changed |
|-----------|-------------|
| Agent instances | `new Agent()` from `@mastra/core/agent` with static tools |
| Dynamic processors | `resolveInputProcessors` / `resolveOutputProcessors` via Mastra's `DynamicArgument` on `requestContext` |
| Tools | Static singletons (`escalateToStaffTool`, `searchKnowledgeBaseTool`) reading deps from module-level refs |
| Mastra singleton | `mastra.ts` — central registry for agents, tools, workflows, memory |
| PGliteStore | Custom storage adapter wrapping PGlite for Mastra's Memory in local dev |
| MastraServer | Mounted at `/api/mastra` inside the vobase Hono server for Studio access |

### Predefined Model Aliases

Replaced env-var-based model configuration (`AI_MODEL`, `AI_EMBEDDING_MODEL`) with a typed model alias map. Agents pick models directly from the map — no conversion, no runtime config.

```typescript
import { models } from '../lib/models';

export const assistantAgent = new Agent({
  model: models.claude_sonnet, // 'anthropic/claude-sonnet-4-6'
});
```

| Alias | Model ID |
|-------|----------|
| `gpt_mini` | `openai/gpt-5-mini` |
| `gpt_standard` | `openai/gpt-5.2` |
| `claude_haiku` | `anthropic/claude-haiku-4-5` |
| `claude_sonnet` | `anthropic/claude-sonnet-4-6` |
| `gemini_flash` | `google/gemini-flash-latest` |
| `gemini_pro` | `google/gemini-3.1-pro-preview` |
| `gpt_embedding` | `openai/text-embedding-3-small` |

## Mastra Memory for Message Storage

Thread messages are now stored and loaded via Mastra Memory instead of a custom `msg_messages` table. The `memory-bridge.ts` module wraps the Memory API for thread lifecycle operations.

- `agent.stream()` and `agent.generate()` receive `memory: { thread, resource }` for auto-persistence
- `GET /threads/:id` transforms Mastra's message format (`{ content: { format: 2, parts } }`) to the frontend's `DbMessage` format
- Seed script initializes Mastra Memory independently for the seed context (separate process from server)
- Removed `msg_messages` table — messages live entirely in Mastra Memory storage

## EverMemOS Memory Pipeline

The memory formation pipeline (boundary detection → episode extraction → fact extraction → embedding) now uses module-level dependency injection via `lib/deps.ts` instead of constructor-injected factories.

## Guardrails & Moderation

Added `onBlock` callback to the moderation input processor for logging blocked content. The `moderation-logger.ts` persists blocks to the new `ai_moderation_logs` table.

### API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /ai/guardrails/config` | Active guardrail rules |
| `GET /ai/guardrails/logs` | Paginated moderation event log |

## Workflow Engine

Added durable workflow run persistence with the `ai_workflow_runs` table. Escalation and follow-up workflows use Mastra's suspend/resume pattern with database-backed state.

### API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /ai/workflows` | List workflow definitions |
| `POST /ai/workflows/:id/trigger` | Start a workflow run |
| `POST /ai/workflows/runs/:id/resume` | Resume a suspended run |
| `GET /ai/workflows/runs` | Paginated run history |
| `GET /ai/workflows/runs/:id` | Run detail with step timeline |

## Memory API

Added paginated endpoints for browsing episodes and facts with scope-based filtering and keyset pagination.

| Endpoint | Description |
|----------|-------------|
| `GET /ai/memory/episodes` | Paginated episodes by scope |
| `GET /ai/memory/facts` | Paginated facts, filterable by episode |
| `DELETE /ai/memory/facts/:id` | Delete a specific fact |
| `DELETE /ai/memory/episodes/:id` | Delete episode + associated facts |

## Evals Pipeline

Eval scorers (answer relevancy, faithfulness) now use the predefined model alias directly instead of reading from env-var config.

## Frontend

### Agent Pages
- Agent detail drawer with instructions, tools, channels, suggestions, and recent threads
- "Chat with agent" action creates a thread and navigates to it
- Model name displayed in card badge and detail header
- Scrollable drawer content via `overflow-hidden` on `ScrollArea`

### Thread Routing
Thread ID is now part of the URL path (`/messaging/threads/:id`) instead of a search param. Split into three route files:
- `threads.tsx` — layout with persistent sidebar + `<Outlet />`
- `threads.index.tsx` — welcome/new-chat view with agent selector and suggestions
- `threads.$threadId.tsx` — chat view with empty-state placeholder when no messages

### Memory Pages
- Memory timeline with scope selector (contact/user)
- Episode/fact browsing with pagination
- Memory search view with hybrid search

### Guardrails Pages
- Guardrail config display
- Moderation log list with pagination

### Workflow Pages
- Workflow run history with status badges
- Run detail view with step timeline

### New Components
- `Sheet` component from shadcn/ui for agent detail drawer

## Dependencies Added

| Package | Purpose |
|---------|---------|
| `@mastra/hono` | Mount MastraServer routes inside Hono |
| `@mastra/pg` | PostgresStore for Mastra Memory in production |

## Environment Variable Changes

- **Removed**: `AI_MODEL`, `AI_EMBEDDING_MODEL`, `AI_EMBEDDING_DIMENSIONS` — replaced by predefined model aliases
- **Renamed**: `GEMINI_API_KEY` → `GOOGLE_GENERATIVE_AI_API_KEY` — aligns with `@ai-sdk/google` convention

## Scaffolder (create-vobase)

The `create-vobase` scaffolder now generates a standalone `biome.json` during project creation. The template's `biome.json` uses `extends` to reference the monorepo root config, which doesn't exist in standalone projects — the scaffolder overwrites it with a self-contained config.

## Test Coverage

293 tests passing across 29 files (657 assertions). Key test areas:
- Moderation processor with `onBlock` callback (12 tests)
- Memory boundary detection and extraction (24 tests)
- Messaging handler routes with Memory-based flow (14 tests)
- AI handler endpoints for memory, guardrails, workflows (new)
- Eval scorer initialization
