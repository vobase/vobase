---
"create-vobase": minor
"@vobase/core": minor
---

Add knip for unused code detection, clean up dead code, and upgrade dependencies

**Knip integration:**
- Configure knip monorepo workspaces for root, core, template, and create-vobase
- Scaffolder generates standalone `knip.json` for projects created with `bun create vobase`

**Dead code cleanup:**
- Delete 19 unused files: dead barrel re-exports, orphaned chat components, duplicate sheet/controls, 6 unused hooks
- Remove 5 unused dependencies: `@ai-sdk/anthropic`, `@radix-ui/react-dialog`, `@radix-ui/react-direction`, `@tanstack/react-virtual`, `react-markdown`
- De-export ~30 file-local types/interfaces, delete dead functions, tag test-only exports with `@lintignore`
- Fix PGlite test isolation with unique temp dirs

**Notable dependency upgrades:**
- `typescript` 5.9 → 6.0
- `drizzle-orm` / `drizzle-kit` beta.18 → beta.19
- `@mastra/core` 1.15 → 1.17, `@mastra/memory` 1.9 → 1.10, `@mastra/hono` 1.2 → 1.3
- `@electric-sql/pglite` 0.4.1 → 0.4.2
- `better-auth` 1.5.5 → 1.5.6
- `vite` 8.0.1 → 8.0.3
- `@biomejs/biome` 2.4.8 → 2.4.9
- `ai` (AI SDK) 6.0.138 → 6.0.140
- `hono` 4.12.8 → 4.12.9
