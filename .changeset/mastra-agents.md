---
"@vobase/core": patch
---

# Mastra Agents: Declarative AI with Multi-Provider Streaming

![Mastra Agents](https://raw.githubusercontent.com/vobase/vobase/main/.changeset/og-mastra-agents-0.19.0.png)

## Declarative Agent Definitions

The messaging module's backend AI orchestration now uses [Mastra](https://mastra.ai) instead of raw AI SDK calls. Agents are defined declaratively — model, tools, and instructions in one place — instead of scattered `streamText()` and `generateText()` calls.

```typescript
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';

const agent = new Agent({
  id: 'chat-support',
  name: 'Support Bot',
  instructions: 'You are a helpful assistant...',
  model: 'openai/gpt-5-mini',
  tools: { search_knowledge_base: kbTool },
  defaultOptions: { maxSteps: 5 },
});
```

Two factory functions create agents from DB config:

| Factory | Use case | Execution | Tools |
|---------|----------|-----------|-------|
| `createChatAgent()` | Web chat | `agent.stream()` | Knowledge base search |
| `createChannelReplyAgent()` | WhatsApp, email | `agent.generate()` | Knowledge base search + escalation |

## Multi-Provider Model Resolution

`toMastraModelId()` maps short model IDs to Mastra's `provider/model` format:

| Input | Output |
|-------|--------|
| `gpt-5-mini` | `openai/gpt-5-mini` |
| `claude-3-5-sonnet` | `anthropic/claude-3-5-sonnet` |
| `gemini-2.0-flash` | `google/gemini-2.0-flash` |
| `openai/gpt-5-mini` | `openai/gpt-5-mini` (passthrough) |

## Streaming Bridge

Mastra agent output bridges to AI SDK's `useChat` frontend via `@mastra/ai-sdk`:

```
agent.stream(messages) → toAISdkStream(result) → createUIMessageStreamResponse({ stream })
```

The frontend (`useChat` from `@ai-sdk/react`) requires zero changes.

## Tool Migration

Tools converted from AI SDK `tool()` to Mastra `createTool()`:

- **search_knowledge_base** — RAG tool with hybrid search, now includes explicit `outputSchema`
- **escalate_to_staff** — Human handoff tool, now includes `id` and `outputSchema`

## Eval Scorers

New `evals.ts` exports a scorer suite using `@mastra/evals` for LLM-as-judge evaluation:

- **Answer Relevancy** — measures response relevance to the user's question
- **Faithfulness** — measures whether the response is grounded in provided context

Scorers are designed for async evaluation (background jobs), not the request path.

## Chat Endpoint Guards

New validation in the chat handler:
- Returns **400** when thread has no agent assigned
- Returns **404** for missing threads (was silently failing)
- Improved error logging for background text persistence failures

## Dependencies Added

| Package | Purpose |
|---------|---------|
| `@mastra/core` | Agent class, createTool, model routing |
| `@mastra/ai-sdk` | `toAISdkStream` bridge to AI SDK UIMessageStream |
| `@mastra/evals` | Answer relevancy + faithfulness scorers |

## What Stayed on AI SDK

- Frontend: `useChat` from `@ai-sdk/react` (unchanged)
- Embeddings: `embed()` / `embedMany()` in knowledge-base (unchanged)
- HyDE + re-ranking: `generateText()` in search.ts (unchanged)
- UI types: `UIMessage` from `ai` package (unchanged)

## Test Coverage

- `agents.test.ts` — 7 tests for `toMastraModelId` (provider mapping, passthrough, unknown prefix warning)
- `handlers.test.ts` — 4 new tests for chat endpoint guards (no agent, not found, AI not configured, message persistence + auto-title)
