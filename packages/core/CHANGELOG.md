# @vobase/core

## 0.4.0

## 0.3.0

## 0.2.0

### Minor Changes

- [`bd9b3c4`](https://github.com/vobase/vobase/commit/bd9b3c4d5cf4da012ad378c03b6094a4908f2da1) Thanks [@mdluo](https://github.com/mdluo)! - Reposition vobase from ERP engine to general app framework built for AI coding agents

  - Rewrite README with new positioning: "own every line, your AI already knows how to build on it"
  - Replace ERP-specific examples with general business app examples (SaaS, internal tools, CRM, project trackers)
  - New comparison table: vs Supabase (simplicity), Pocketbase (transparency), Rails/Laravel (AI-native)
  - Remove ERP branding from all skill files, manifest, CLAUDE.md, template AGENTS.md, and CLI README
  - Reframe core skills (integer-money, status-machines, gap-free-sequences) as universal app patterns

## 0.1.10

### Patch Changes

- [`a1036b0`](https://github.com/vobase/vobase/commit/a1036b078877f9870f2e8e883d78298c9df7da76) Thanks [@mdluo](https://github.com/mdluo)! - fix: include app routes in generate, add baseURL to auth, copy .env on init

## 0.1.9

### Patch Changes

- [`1421074`](https://github.com/vobase/vobase/commit/14210745b50ba8acb8d8843deb92224eea099d5b) Thanks [@mdluo](https://github.com/mdluo)! - fix: track template src/data by scoping gitignore data/ to root only

## 0.1.8

### Patch Changes

- [`02e2604`](https://github.com/vobase/vobase/commit/02e260484fd132d2f6daec509a716f3869b5da48) Thanks [@mdluo](https://github.com/mdluo)! - fix: only skip data/dist/node_modules at root level during post-processing

## 0.1.7

### Patch Changes

- [`bf7bc85`](https://github.com/vobase/vobase/commit/bf7bc859f7dad9cdc6042228bf62ba89352d244c) Thanks [@mdluo](https://github.com/mdluo)! - feat: support `vobase init` in current directory with git-clean safety check

## 0.1.6

### Patch Changes

- [`9c1f3a2`](https://github.com/vobase/vobase/commit/9c1f3a28ffc5453045ee46bd2260db3d6cf8b970) Thanks [@mdluo](https://github.com/mdluo)! - feat: run drizzle-kit push during init for zero-config setup

## 0.1.5

### Patch Changes

- [`42b92e5`](https://github.com/vobase/vobase/commit/42b92e550482a73e8da88f1da172c103d5d9ed39) Thanks [@mdluo](https://github.com/mdluo)! - fix: remove misleading @better-auth/cli generate step from init output

## 0.1.4

### Patch Changes

- feat: fetch template from GitHub instead of bundling in npm package

## 0.1.3

### Patch Changes

- [`b59a220`](https://github.com/vobase/vobase/commit/b59a220916a9fb49c610a935342efaea55cb0708) Thanks [@mdluo](https://github.com/mdluo)! - fix: correct package.json path resolution in init command

## 0.1.2

### Patch Changes

- [`e78d5f0`](https://github.com/vobase/vobase/commit/e78d5f03799aeb49370001919334f21fa63dc374) Thanks [@mdluo](https://github.com/mdluo)! - fix: resolve workspace:\* dependency to actual version during npm publish

## 0.1.1

### Patch Changes

- Add changesets and GitHub Actions for automated npm publishing. Fix manifest path in add-skill test.
