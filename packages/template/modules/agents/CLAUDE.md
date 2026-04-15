# Agents Module

AI agents that handle customer conversations autonomously. Powered by Mastra, using a workspace-based architecture where agents interact through a virtual filesystem and CLI commands.

## How Agents Work

Each agent wake creates an in-memory workspace — a virtual filesystem pre-populated with everything the agent needs to know (conversation history, contact profile, business identity, past notes). The agent gets a single bash tool and operates by reading files and running vobase CLI commands. This replaces 19 individual Mastra tools with one, reducing per-wake token overhead by ~94%.

The agent reads context on demand (cat files), takes actions via CLI (vobase reply, vobase book, vobase resolve), and writes observations to notes files that persist across conversations.

## Wake Lifecycle

When a message arrives, a debounced job schedules an agent wake:

1. Build workspace — materialize conversation messages, contact profile, conversation state, and business config into markdown files in a virtual FS
2. Build wake message — inject recent messages inline with token budget
3. Run agent — LLM generates bash commands against the workspace
4. Sync changes — diff files modified during the run, write back to DB
5. Score — evaluate conversation quality (fire-and-forget)

Concurrency is guarded by Postgres advisory locks per conversation. Stale wakes (where the agent already replied) are detected and skipped.

## Workspace

Global files (AGENTS.md for operating manual, SOUL.md for business identity) are stored in the workspace_files DB table and loaded into every wake. Per-contact files (notes.md) are scoped by agentId + contactId. Some files are lazy-loaded — bookings and KB snippets are only fetched from DB if the agent actually reads them.

The agent writes observations to contact/notes.md using echo. These notes persist across conversations and help the agent build context about returning customers.

## vobase CLI

All agent actions go through vobase subcommands registered as a just-bash custom command.

Commands are organized into three groups: conversation (reply, resolve, reassign, hold, etc.), booking (check-slots, book, reschedule, cancel), and query (search-kb, analyze-media, recall). Each command handler receives parsed positional args, flags, and a WakeContext with DB access.

To add a new command: write the handler function, add it to the appropriate commands record, and update the AGENTS.md CLI reference in seed-workspace.ts so the agent knows about it.

## Memory

Mastra memory is configured with lastMessages, semanticRecall, and workingMemory all disabled — the workspace files replace these. Observational memory stays enabled to compress the agent's reasoning thread across wakes. Thread IDs use the pattern agent-{agentId}-conv-{conversationId}.

## Agents

Agent definitions live in mastra/agents/. Each agent has metadata (id, name, model, channels, mode) and workspace-oriented instructions telling the LLM to read AGENTS.md for the full command reference. Tools are empty — the single bash tool is injected at wake time via Mastra's toolsets mechanism.

## Scoring

After each wake, registered Mastra scorers evaluate the conversation using real messages from the messaging module. Custom scorer definitions can be published via the Mastra storage API.

## Business Identity

SOUL.md defines the business personality, services, pricing, policies, and escalation rules. The seed uses a fictional Singapore medical clinic (OrchardHealth). In production, this would be configured per-business. Escalation rules in SOUL.md drive the agent's behavior for complaints, medical questions, insurance issues, etc.

## Shell Escaping

The workspace uses just-bash (in-process TypeScript bash interpreter). Agent instructions must tell the LLM to escape shell metacharacters in tool arguments — especially `$` (prefix with `\`), quotes, and backticks. Without escaping, `$80` expands as variable `$8` + literal `0`.
