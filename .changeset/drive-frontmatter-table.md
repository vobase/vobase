---
"@vobase/template": minor
"create-vobase": minor
---

Drive editor: render markdown frontmatter as a read-only table above the editable surface.

`drive/components/drive-markdown-editor.tsx` now ships the GFM-table plugin set plus a frontmatter splitter that pulls leading YAML out of skill / profile markdown and renders it as a read-only `PlateStatic` table. The raw frontmatter is preserved verbatim and re-prepended on save so the on-disk YAML stays byte-stable.

Also fixes the AGENTS.md preamble preview in `agents/components/agents-md-editor.tsx`: the editor now uses `createSlateEditor({ value })` (mutating `ed.children` after construction never propagated to the rendered tree). Collapsed view stays at `max-h-48` with the fade gradient; expanded drops the cap so the preamble flows into the parent scroll container.

`agents/handlers/definitions.ts` awaits `materialize()` and `renderPreviewAgentsMd` so the preamble route returns the rendered markdown instead of `[object Promise]`.
