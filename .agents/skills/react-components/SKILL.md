---
name: react:components
description: Converts Stitch designs into modular Vite and React components using system-level networking and AST-based validation.
allowed-tools:
  - "stitch*:*"
  - "Bash"
  - "Read"
  - "Write"
  - "web_fetch"
---

# Stitch → React Components (shadcn/ui + Tailwind)

Transform Stitch designs into modular React code using **shadcn/ui** and **Tailwind CSS**. Load the `shadcn-ui` skill for component discovery, installation, theming, and API reference.

## Stitch design generation

When calling `generate_screen_from_text` or `edit_screens`, always append to the prompt:

> Style this in a clean, modern aesthetic using Tailwind CSS utility classes.

## Stitch retrieval

1. Call `get_screen` to retrieve the design JSON (discover the Stitch MCP prefix via `list_tools` first).
2. **HTML is the primary source.** Download `htmlCode.downloadUrl` to a **local temp file** before reading it. Use: `bash .agents/skills/react-components/scripts/fetch-stitch.sh "<url>" "temp/source.html"`. Then read the downloaded file with the Read tool.
3. **CRITICAL: Always download HTML to disk first.** Never read Stitch HTML directly in the orchestrator's context — it's too large and wastes token budget. Download to `temp/<descriptive-name>.html` and have sub-agents read from disk. This applies to both orchestrators delegating work and sub-agents doing the conversion.
4. **Do not use screenshots.** Never use the screenshot URL as a substitute for reading the HTML. Never ask another AI to describe a screenshot — the HTML contains the exact DOM, CSS tokens, text, and asset URLs. Screenshots lose fidelity and waste tokens on vision processing.

## Architectural rules

* Break designs into modular component files — no monoliths.
* Event handlers and logic → custom hooks in `src/hooks/`.
* Static text, image URLs, lists → `src/data/mockData.ts`.
* Every component gets a `Readonly<[Name]Props>` interface.
* Use shadcn/ui components for standard UI primitives (Button, Card, Badge, Dialog, etc.). Load the `shadcn-ui` skill for component selection and API usage. Fall back to semantic HTML + Tailwind only when no shadcn equivalent exists.
* Extract design tokens from the Stitch HTML `<head>` into CSS variables in `src/globals.css` (see `resources/style-guide.json`). Use Tailwind utility classes — no inline hex codes.
* Omit Google license headers from generated components.

## Code quality

Follow `resources/code-quality-guide.md` for all component work — covers type safety, DRY, Tailwind styling (CSS modules where needed, utility classes for one-offs), correct hook/component usage, accessibility, and theme defaults.

## Execution steps

1. Run `bun install` if `node_modules` is missing.
2. Create/update `src/globals.css` — map Stitch design tokens to Tailwind CSS variables.
3. Create `src/data/mockData.ts` from design content.
4. Draft components from `resources/component-template.tsx` — replace `StitchComponent` placeholder, use shadcn/ui components (load the `shadcn-ui` skill for guidance) and Tailwind classes.
5. Wire into app entry.
6. Validate: `bun run validate <file>`, check `resources/architecture-checklist.md`, run `bun run dev`.

## Troubleshooting

* **Fetch errors**: Quote the URL in the bash command.
* **Validation errors**: Check AST report for missing interfaces or hardcoded styles.
* **Missing shadcn components**: Run `bunx shadcn@latest add <component>` to install.
* **Style conflicts**: Use the `cn()` utility from `src/lib/utils.ts` for class merging.
