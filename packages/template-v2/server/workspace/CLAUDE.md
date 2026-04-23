## server/workspace/

Virtual filesystem backed by DB queries. Agent navigates with native bash (`ls`, `cat`, `grep`, `find`) — LLMs are trained on bash, leverage that.

**Materializers run before side-load, not before the system prompt.** This is the mechanical consequence of frozen-snapshot: the agent sees turn-0 state in the system prompt, and turn-N+1 writes in turn-N's side-load. If you add a new materializer, it updates the virtual FS the *next* turn sees — never the current one. `workspaceSyncObserver` marks paths dirty after mutations.

**RO enforcement by scope.** `ScopedFs` blocks agent writes to `/drive/**` (organization scope, proposal flow only) and exact per-wake RO paths (`/agents/<agentId>/AGENTS.md`, `/contacts/<contactId>/profile.md`). Direct-write zones: `/contacts/<contactId>/drive/**` and `/tmp/**`. Memory files (`/agents/<agentId>/MEMORY.md`, `/contacts/<contactId>/MEMORY.md`) route writes through `vobase memory …` and render a helpful hint on direct `echo >` attempts.

**Virtual layout** (what appears in the system prompt):
```
/agents/<agentId>/AGENTS.md                          CLI + workspace reference (auto-generated)
/agents/<agentId>/MEMORY.md                          agent working memory (markdown sections)
/agents/<agentId>/skills/                            merged: code-shipped + learned
/contacts/<contactId>/profile.md                     contact identity (RO, identity-in-contents)
/contacts/<contactId>/MEMORY.md                      per-contact working memory (via `vobase memory … --scope=contact`)
/contacts/<contactId>/<channelInstanceId>/messages.md   customer-visible timeline (RO)
/contacts/<contactId>/<channelInstanceId>/internal-notes.md staff ↔ agent notes (RO)
/contacts/<contactId>/drive/                         contact-scope (RW)
/staff/<staffId>/profile.md                          staff identity (RO, identity-in-contents)
/staff/<staffId>/MEMORY.md                           per-(agent, staff) memory (via `vobase memory …`)
/drive/                                              organization-scope (RO, proposal for writes)
/drive/BUSINESS.md                                   organization brand/products/policies, seeded at provisioning
/tmp/tool-<callId>.txt                               stdout spill files
```

**Agents.md generator is code-driven, not hand-written.** `agents-md-generator.ts` synthesizes the CLI reference, framework preamble, and the agent's instructions from registered `AgentTool` + `CommandDef` + the `agent_definitions.instructions` column. Don't hand-edit the rendered AGENTS.md — edit registrations or the instructions column.
