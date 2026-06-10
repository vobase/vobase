---
"@vobase/template": patch
---

# Memory lessons supersede instead of contradicting; duplicate appends no-op

Agent memory only ever grew by appending: a staff correction landed *next to* the lesson it overrode, leaving both in `## Active lessons` with no way for future wakes to tell which wins, and re-learned lessons accumulated as duplicate lines (observed in production: the same lesson six times, plus contradictory handoff rules side by side).

- **`remember` now teaches `mode: 'replace'`** — the mode existed end-to-end (schema → `markdown_patch` → materializer → changes UI) but no guidance ever mentioned it. The tool prompt now says: check the scope's existing memory first; append only genuinely new lessons; replace with the full revised blob when a lesson corrects, contradicts, or supersedes an existing line. The prompt's stale pointer to a nonexistent "Memory & sensitivity" AGENTS.md table now points at the real `## Memory scopes` heading.
- **Supersede-never-contradict guidance** added to the `agents.memory-capture-triggers` and `agents.memory-conventions` AGENTS.md blocks and the static bash-sandbox instructions (`wake/prompt.ts`) — revising or removing a stale `MEMORY.md` line is as valid as appending a new one.
- **Verbatim-duplicate appends are idempotent no-ops** — new shared `mergeMarkdownPatch` helper (exported from `@modules/changes/service/proposals` next to `assertMarkdownPatch`), wired into all three memory materializers (agent / contact / staff): an `append` whose every non-empty line already exists trimmed-verbatim in the blob returns the blob unchanged. `replace` behavior and confidence × sensitivity routing are unchanged.
