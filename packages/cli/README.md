# @vobase/cli (deprecated)

> **Note:** Project scaffolding has moved to [`create-vobase`](https://www.npmjs.com/package/create-vobase). Use `bun create vobase my-app` instead.

CLI helpers for [Vobase](https://github.com/vobase/vobase). Most commands have been replaced by direct tool usage in scaffolded projects:

| Old command | Replacement |
|---|---|
| `vobase init` | `bun create vobase my-app` |
| `vobase dev` | `bun run dev` (concurrently) |
| `vobase db:push` | `drizzle-kit push` |
| `vobase db:migrate` | `drizzle-kit migrate` |
| `vobase db:generate` | `drizzle-kit generate` |
| `vobase generate` | `bun run scripts/generate.ts` |

### Still available

| Command | What it does |
|---|---|
| `vobase migrate` | Bun-native migration runner with automatic backup (wraps drizzle-orm directly) |
| `vobase add skill <name>` | Install an agent skill into `.agents/skills/` |

## License

MIT
