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

- `service/journal.append(event, tx?)` — sole write path for `agents.conversation_events` (spec §2.3)
- `service/agent-definitions.getById(id)` — reads from `agent_definitions`

## Spec reference

See `v2-greenfield-spec.md` §5.3 for schema, §2.3 for single-write-path invariant.
