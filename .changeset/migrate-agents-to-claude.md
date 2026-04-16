---
"create-vobase": patch
---

Migrate scaffolder from `.agents/skills` to `.claude/skills`

The repo moved agent skills from `.agents/skills/` to `.claude/skills/` and replaced `AGENTS.md` with `CLAUDE.md`. This updates the scaffolder to match:

- **Remove CLAUDE.md → AGENTS.md symlink** — scaffolded projects now have `CLAUDE.md` as the primary file, no symlink needed
- **Copy skills directly to `.claude/skills/`** — no intermediate `.agents/skills/` directory or symlinks
- **Clean up unused imports** — `readdirSync`, `rmSync`, `symlinkSync`, `relative` no longer needed
- **Update biome exclude** — `!.agents` → `!.claude` in generated `biome.json`
