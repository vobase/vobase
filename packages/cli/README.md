# @vobase/cli

CLI and project scaffolding for [Vobase](https://github.com/voltade/vobase) — the app framework built for AI coding agents.

## Installation

```bash
bun add -g @vobase/cli
```

## Commands

| Command | What it does |
|---|---|
| `vobase init` | Scaffold a new project |
| `vobase dev` | Start dev server (backend + frontend) |
| `vobase migrate` | Run database migrations |
| `vobase migrate:generate` | Generate migration files |
| `vobase generate` | Rebuild route tree and system schemas |
| `vobase add skill <name>` | Install an ERP agent skill |

## Quick Start

```bash
bunx @vobase/cli init my-erp
cd my-erp
bun install
bunx vobase dev
```

See the [full documentation](https://github.com/voltade/vobase) for details.

## License

MIT
