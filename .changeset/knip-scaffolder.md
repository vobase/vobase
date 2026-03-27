---
"create-vobase": minor
"@vobase/core": minor
---

Add knip for unused code detection and clean up dead code

- Configure knip monorepo workspaces for root, core, template, and create-vobase
- Scaffolder now generates standalone `knip.json` for projects created with `bun create vobase`
- Delete 19 unused files: dead barrel re-exports, orphaned chat components, duplicate sheet/controls, 6 unused hooks
- Remove 5 unused dependencies: `@ai-sdk/anthropic`, `@radix-ui/react-dialog`, `@radix-ui/react-direction`, `@tanstack/react-virtual`, `react-markdown`
- De-export ~30 file-local types/interfaces, delete dead functions, tag test-only exports with `@lintignore`
- Fix PGlite test isolation with unique temp dirs
