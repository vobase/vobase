## server/workspace/

Virtual filesystem backed by DB queries. Agent navigates with native bash (`ls`, `cat`, `grep`, `find`) — LLMs are trained on bash, leverage that.

**Materializers run before side-load, not before the system prompt.** This is the mechanical consequence of frozen-snapshot: the agent sees turn-0 state in the system prompt, and turn-N+1 writes in turn-N's side-load. If you add a new materializer, it updates the virtual FS the *next* turn sees — never the current one. `workspaceSyncObserver` marks paths dirty after mutations.

**RO enforcement by scope.** `ScopedFs` blocks agent writes to `/workspace/drive/**` (tenant scope, proposal flow only) and `/workspace/AGENTS.md` (auto-generated from registered tools/commands/skills). Agent-writable: `/workspace/MEMORY.md`, `/workspace/contact/notes.md`, `/workspace/contact/drive/**`, `/workspace/tmp/**`.

**Virtual layout** (what appears in the system prompt):
```
/workspace/AGENTS.md      CLI + workspace reference (auto-generated)
/workspace/MEMORY.md      agent working memory (markdown sections)
/workspace/skills/        merged: code-shipped + learned
/workspace/conversation/messages.md
/workspace/drive/         tenant-scope (RO, proposal for writes)
/workspace/drive/BUSINESS.md   tenant brand/products/policies, seeded at provisioning
/workspace/contact/notes.md    working memory for current contact
/workspace/contact/drive/      contact-scope (RW)
/workspace/tmp/tool-<callId>.txt   stdout spill files
```

**Agents.md generator is code-driven, not hand-written.** `agents-md-generator.ts` synthesizes the CLI reference from registered `AgentTool` + `CommandDef` + skills. Don't hand-edit `/workspace/AGENTS.md` — edit registrations.
