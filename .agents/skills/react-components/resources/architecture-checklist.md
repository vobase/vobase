# Architecture Quality Gate

### Structural integrity
- [ ] Logic extracted to custom hooks in `src/hooks/`.
- [ ] No monolithic files; strictly Atomic/Composite modularity.
- [ ] All static text/URLs moved to `src/data/mockData.ts`.

### Type safety and syntax
- [ ] Props use `Readonly<T>` interfaces.
- [ ] File is syntactically valid TypeScript (no red squiggles).
- [ ] Placeholders from templates (e.g., `StitchComponent`) have been replaced with actual names.

### Component usage
- [ ] Standard UI primitives use shadcn/ui components (Button, Card, Badge, Dialog, Input, etc.) — not raw HTML elements for those concerns.
- [ ] Correct shadcn/ui imports from `@/components/ui/`.
- [ ] No inline hardcoded hex color values — use Tailwind theme tokens or CSS variables.

### Theming and styling
- [ ] `src/globals.css` contains CSS variables mapping design tokens.
- [ ] Tailwind utility classes used for styling — not inline `style={{}}` with arbitrary values.
- [ ] Dark mode handled via Tailwind `dark:` variant and CSS variable overrides.
- [ ] Repeated styling patterns extracted to component variants via `cva()` or Tailwind `@apply`.
- [ ] Class merging uses the `cn()` utility (from `src/lib/utils.ts`).

### Code quality (see `code-quality-guide.md`)
- [ ] No duplicated type guards, status mappings, or API paths across files.
- [ ] Every `useMutation` has an `onError` handler.
- [ ] No dead UI (buttons without handlers) or dead code paths.
- [ ] Aggregates (counts, totals) come from the API — not client-side `.filter().length` on paginated data.
