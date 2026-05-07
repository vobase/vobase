---
'@vobase/template': patch
---

# Resizable Drive + collapsible AGENTS.md preamble

Three UI tweaks on the agent detail page (`/agents/<id>`) and any page that embeds `<DriveSection>`:

- **Drive split is now user-resizable.** Both the horizontal Drive layout (contact + staff detail pages) and the vertical Drive layout (agent detail page) now wrap the file list and preview in `react-resizable-panels` `Group`/`Panel` with a draggable `GradientResizeHandle` between them. Sizes persist per-orientation in `localStorage` (`vobase:drive-horizontal`, `vobase:drive-vertical`).
- **File list defaults to a smaller portion in vertical layouts.** The vertical split was a fixed 1:2 grid (33% file list / 67% preview). New default is 28% / 72%, and the user can drag to anywhere between 15%–60% for the list. Horizontal layouts default 40% / 60% (was a fixed 1:1).
- **AGENTS.md auto-generated preamble is collapsed by default.** On the agent detail page, the read-only preamble at the top of `/AGENTS.md` previously occupied the full preview height and forced staff to scroll past it before they could see the editable instructions. The preamble now opens collapsed (`max-h-32` with a bottom-fade) with a `Show more / Show less` toggle, and its background is `bg-muted` (was `bg-muted/40`) so it visually separates from the surrounding `bg-background` `InfoCard` instead of blending in.

**Changed:**

- `modules/drive/components/drive-browser.tsx` — replaces the orientation-conditional CSS grid with `react-resizable-panels`. The empty-preview path (no file selected) keeps a plain full-bleed file list. Mobile fallback is unchanged (single pane with a back-bar).
- `modules/agents/components/agents-md-editor.tsx` — `PreambleView` gains a `useState` collapse toggle and a fade-mask overlay; bg bumped to `bg-muted`.
- `src/components/ui/gradient-resize-handle.tsx` — `GradientResizeHandle` gains a `direction: 'col' | 'row'` prop. Default `'col'` keeps existing call sites byte-identical; `'row'` switches to `h-px w-full cursor-row-resize` for use inside a vertical `Group`.

No backend, schema, or harness changes.
