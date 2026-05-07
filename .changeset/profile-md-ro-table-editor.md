---
'@vobase/core': patch
'@vobase/template': minor
---

template: PROFILE.md is now read-only at the workspace level. Customer-asked profile updates flow through the new `vobase contacts propose-change` CLI verb (default `--kind field_set`; `--kind markdown_patch` for prose). Non-gated fields auto-apply; gated fields (`displayName`, `email`) queue for staff review. Activity events (`change.proposed` / `change.auto_applied` / `change.approved` / `change.rejected`) render inline in the staff-inbox timeline with the proposing/deciding principal and a discrete InfoIcon HoverCard for rationale + decision notes.

template: GFM tables in AGENTS.md (and other markdown surfaces using the same Plate editor) now render in the content editor — added `@platejs/table` and registered table/row/cell/header element components. Previously the Memory-scopes table appeared as blank space.

template/changes: duplicate-pending proposals on the same contact now surface as a typed `pending_conflict` errorCode (with `existingProposalId`) instead of a generic 409. The `vobase contacts propose-change` verb prompt instructs the agent to acknowledge the prior pending request rather than fabricate an approval.

core/workspace: removed unused `contactProfile` / `staffProfile` dirty-diff buckets from `ScopedDiff`. The template no longer tracks PROFILE.md frontmatter as dirty (it's RO and rendered from the row).
