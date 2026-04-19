---
name: agents
version: "1.0"
provides:
  tools:
    - reply
    - send_card
    - send_file
    - book_slot
    - subagent
  observers:
    - auditObserver
    - sseObserver
    - workspaceSyncObserver
    - scorerObserver
    - memoryDistillObserver
  mutators:
    - moderationMutator
    - approvalMutator
  materializers:
    - frozenPromptBuilder
    - sideLoadCollector
permissions: []
---

# agents module

Owns the AI agent harness, conversation event journal, agent definitions, learning proposals, and agent scores.

## Phase 1 real methods

- `service/journal.append(event, tx?)` — sole write path for `agents.conversation_events` (one-write-path invariant)
- `service/agent-definitions.getById(id)` — reads from `agent_definitions`

## Schema

See `schema.ts` for the full Drizzle schema (agents module tables live in the `agents` pgSchema). `journal.append` is the ONLY writer to `conversation_events` — direct inserts elsewhere are forbidden.
