<p align="center">
  English / <a href="README_CN.md">中文</a>
</p>

<p align="center">
  <b>vobase</b>
  <br>
  The app framework built for AI coding agents.<br>
  Own every line. Your AI already knows how to build on it.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@vobase/core"><img src="https://img.shields.io/npm/v/@vobase/core.svg" alt="npm @vobase/core"></a>
  <a href="https://www.npmjs.com/package/@vobase/core"><img src="https://img.shields.io/npm/dm/@vobase/core.svg" alt="npm downloads"></a>
  <a href="https://github.com/vobase/vobase"><img src="https://img.shields.io/github/stars/vobase/vobase" alt="GitHub stars"></a>
  <a href="https://github.com/vobase/vobase/commits/main"><img src="https://img.shields.io/github/last-commit/vobase/vobase" alt="Last commit"></a>
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License MIT">
  <a href="https://discord.gg/sVsPBHtvTZ"><img
  src="https://img.shields.io/badge/discord-join-5865F2?logo=discord&logoColor=white"
  alt="Discord"></a>
  <br>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Bun-000?style=for-the-badge&logo=bun&logoColor=white" alt="Bun">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Hono-E36002?style=for-the-badge&logo=hono&logoColor=white" alt="Hono">
  <img src="https://img.shields.io/badge/Drizzle-C5F74F?style=for-the-badge&logo=drizzle&logoColor=black" alt="Drizzle">
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/Better_Auth-16a34a?style=for-the-badge" alt="Better Auth">
  <img src="https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React">
  <img src="https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite">
  <img src="https://img.shields.io/badge/TanStack-EF4444?style=for-the-badge&logo=reactquery&logoColor=white" alt="TanStack">
  <img src="https://img.shields.io/badge/Tailwind-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white" alt="Tailwind CSS">
  <img src="https://img.shields.io/badge/shadcn/ui-000?style=for-the-badge&logo=shadcnui&logoColor=white" alt="shadcn/ui">
</p>

<p align="center">
  <a href="#what-you-get">what you get</a> ·
  <a href="#quick-start">get started</a> ·
  <a href="#what-a-module-looks-like">code</a> ·
  <a href="#agent-harness">harness</a> ·
  <a href="#vs-the-alternatives">compare</a> ·
  <a href="https://docs.vobase.dev">docs</a>
</p>

---

A full-stack TypeScript framework that gives you auth, database, storage, jobs, and a first-class AI agent runtime in a single Bun process. Docker Compose Postgres for local dev, managed Postgres in production. Like a self-hosted Supabase — but you own every line of code. Like Pocketbase — but it's TypeScript you can read and modify.

AI coding agents (Claude Code, Cursor, Codex) understand vobase out of the box. Strict conventions and a uniform module shape mean generated code works on the first try — not the third.

You own the code. You own the data. You own the infrastructure.

---

### what you get

One `bun create vobase` and you have a working full-stack app:

| Primitive | What it does |
|---|---|
| **Runtime** | **Bun** — native TypeScript, ~50ms startup, built-in test runner. One process, one container. |
| **Database** | **PostgreSQL** via **Drizzle**. Docker Compose Postgres (pgvector/pg17) for local dev, managed Postgres in production. Full SQL, ACID transactions, pgvector for embeddings. |
| **Auth** | **better-auth**. Sessions, passwords, email OTP, CSRF. RBAC with role guards, API keys, organizations. SSO/2FA as plugins. |
| **API** | **Hono** — ~14KB, typed routing, Bun-first. Every AI coding tool already knows Hono. |
| **Audit** | Built-in audit log, record change tracking, and auth event hooks. Every mutation is traceable. |
| **Sequences** | Gap-free business number generation (INV-0001, PO-0042). Transaction-safe, never skips. |
| **Storage** | File storage with virtual buckets. Local or S3/R2 backends. Metadata tracked in Postgres. |
| **Channels** | Multi-channel messaging with pluggable adapters: WhatsApp (Cloud API), email (Resend, SMTP). Inbound webhooks, outbound sends, delivery tracking. All messages logged. |
| **Integrations** | Encrypted credential vault for external services. AES-256-GCM at rest. Platform-aware: opt-in multi-tenant OAuth handoff via HMAC-signed JWT. |
| **Jobs** | Background tasks with retries, cron, and job chains. **pg-boss** backed — Postgres only, no Redis. |
| **Realtime** | Server-push via PostgreSQL `LISTEN/NOTIFY` + SSE. No WebSocket. Modules `pg_notify` after commit; the frontend hook invalidates matching TanStack Query keys. |
| **Agent harness** | First-class AI agent runtime (`pi-agent-core` + `pi-ai`). Frozen system prompt per wake, byte-stable provider cache, tool budget spill, steer/abort between turns, journaled events, idle resumption, restart recovery. |
| **Workspace** | Virtual filesystem materialized per-wake from your modules. AGENTS.md is composed from per-module fragments; agents read `/staff/<id>/profile.md`, `/contacts/<id>/MEMORY.md`, etc. RO enforcement at the FS boundary. |
| **CLI** | **`@vobase/cli`** — standalone, catalog-driven binary. Modules register verbs via `defineCliVerb`; the same body runs in-process (agent bash sandbox) and over HTTP-RPC (`vobase` binary). |
| **Frontend** | **React + TanStack Router + shadcn/ui + ai-elements + DiceUI + Tailwind v4**. Type-safe routing with codegen, code-splitting. You own the component source. |
| **MCP** | Model Context Protocol server in the same process. AI tools can read your schema, list modules, and view logs before generating code. |
| **Deploy** | Dockerfile + railway.json included. One `railway up` or `docker build` and you're live. |

Locally, `docker compose up -d` starts a pgvector/pg17 Postgres instance. `bun run dev` and you're building. In production, point `DATABASE_URL` at any managed Postgres.

---

### quick start

```bash
bun create vobase my-app
cd my-app
docker compose up -d
bun run db:reset
bun run dev
```

Backend on `:3001`, frontend on `:5173`. Ships with the agent-native helpdesk template — messaging, channels, contacts, team, drive, agents — already wired up.

---

### what you can build

Every module is a self-contained directory: schema, service, handlers, jobs, pages, and an `agent.ts` slot that publishes tools, materializers, RO hints, and AGENTS.md fragments to the harness. No plugins, no marketplace. Just TypeScript you own.

| Use Case | What Ships |
|---|---|
| **Agent-native helpdesk** | The default template. WhatsApp + email inbox, contact memory, staff-mention fan-out, supervisor coaching, scheduled follow-ups, approval gates, drive overlays. |
| **SaaS Starter** | User accounts, billing integration, subscription management. Auth + jobs + webhooks handle the plumbing. |
| **Internal Tools** | Admin panels, operations dashboards, approval workflows. Status machines enforce business logic. Audit trails track every change. |
| **CRM & Contacts** | Companies, contacts, interaction timelines, deal tracking. Cross-module references via service imports — no FK across module boundaries. |
| **Project Tracker** | Tasks, assignments, status workflows, notifications. Background jobs handle reminders and escalations. |
| **Billing & Invoicing** | Invoices, line items, payments, aging reports. Integer money ensures exact arithmetic. Gap-free numbering via transactions. |
| **Your Vertical** | Property management, fleet tracking, field services — whatever the business needs. Describe it to your AI tool. It generates the module. |

AI coding agents generate modules from your conventions. Like `npx shadcn add button` — files get copied, you own the code.

---

### how it works

Vobase makes itself legible to every AI coding tool on the market.

The framework ships with one canonical module shape, one write-path discipline, and a harness that AI agents drive at runtime. When you need a new capability:

1. Open your AI tool and describe the requirement
2. The AI reads your existing schema, the canonical module shape, and the relevant `.claude/skills/` packs
3. It generates a complete module — schema, service, handlers, jobs, pages, agent slot, tests, seed data
4. You review the diff, run `bun run dev`, and it works

Skill packs cover the parts where apps get tricky: money stored as integer cents (never floats), status transitions as explicit state machines (not arbitrary string updates), gap-free business numbers generated inside database transactions, single-write-path enforcement via `check:shape`, frontend bundle isolation via `check:bundle`.

These conventions are what make AI-generated modules work on the first try.

**The thesis:** your specs and domain knowledge are the asset. AI tools are the compiler. The compiler improves every quarter. Your skills compound forever.

---

### what a module looks like

Every module is a thin aggregator over sibling files. `module.ts` declares the contract; everything else lives next to the code that owns the side-effect.

```typescript
// modules/projects/module.ts
import type { ModuleDef } from '~/runtime'
import { projectsAgent } from './agent'
import { projectListVerb } from './verbs/project-list'
import { createProjectsService, installProjectsService } from './service/projects'
import * as web from './web'

const projects: ModuleDef = {
  name: 'projects',
  requires: ['team'],
  web: { routes: web.routes },
  jobs: [],
  agent: projectsAgent,
  init(ctx) {
    installProjectsService(createProjectsService({ db: ctx.db }))
    ctx.cli.registerAll([projectListVerb])
  },
}

export default projects
```

```
modules/projects/
  module.ts            ← thin aggregator (above)
  schema.ts            ← Drizzle table definitions
  state.ts             ← status transitions, state machine
  service/             ← transactional write-path (sole writer of this module's tables)
  handlers/            ← Hono routes (HTTP API)
  web.ts               ← route barrel mounted under /api/projects
  pages/               ← React pages — list, detail, create
  components/          ← React components owned by this module
  hooks/               ← TanStack Query hooks
  jobs.ts              ← pg-boss handlers
  agent.ts             ← agent slot: tools, materializers, roHints, AGENTS.md fragments
  tools/               ← defineAgentTool — colocated with the service
  verbs/               ← defineCliVerb — runs in agent bash and the CLI binary
  cli.ts               ← barrel exporting <module>Verbs
  seed.ts              ← demo data
  defaults/            ← *.agent.yaml, *.schedule.yaml — opt-in starter content
  skills/              ← inline skill bodies the agent reads via drive overlay
  *.test.ts            ← colocated bun test
```

<details>
<summary><b>schema example</b> — Drizzle + PostgreSQL with typed columns, timestamps, status enums</summary>

```typescript
// modules/projects/schema.ts
import { pgTable, text, integer, timestamp, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { nanoidPrimaryKey } from '@vobase/core'

export const projects = pgTable('projects', {
  id: nanoidPrimaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').notNull().default('active'),
  ownerId: text('owner_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('projects_status_chk', sql`${t.status} in ('active','archived','deleted')`),
])

export const tasks = pgTable('tasks', {
  id: nanoidPrimaryKey(),
  projectId: text('project_id').references(() => projects.id),
  title: text('title').notNull(),
  status: text('status').notNull().default('todo'),
  assigneeId: text('assignee_id'),
  priority: integer('priority').notNull().default(0),
}, (t) => [
  check('tasks_status_chk', sql`${t.status} in ('todo','in_progress','done')`),
])
```

`check:shape` enforces that only `service/projects.ts` writes to `projects` — handlers and jobs go through the service.

</details>

<details>
<summary><b>handler example</b> — Hono routes with Zod validation, typed RPC client</summary>

```typescript
// modules/projects/handlers/list.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { getCtx } from '~/runtime'
import { projectsService } from '../service/projects'

export const listRoute = new Hono().get(
  '/',
  zValidator('query', z.object({ status: z.enum(['active','archived']).optional() })),
  async (c) => {
    const ctx = getCtx(c)
    const { status } = c.req.valid('query')
    const items = await projectsService().list({ ownerId: ctx.user.id, status })
    return c.json(items)
  },
)
```

The frontend gets fully typed API calls via the Hono RPC client (`src/lib/api-client.ts`):

```typescript
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const res = await api.projects.$get({ query: {} })
      return await res.json() // fully typed
    },
  })
}
```

`use-realtime-invalidation.ts` maps `pg_notify` `table` payloads onto the first element of TanStack `queryKey` — services emit notifies after commit and the UI re-fetches automatically.

</details>

<details>
<summary><b>job example</b> — background tasks via pg-boss, no Redis</summary>

```typescript
// modules/projects/jobs.ts
import { defineJob } from '@vobase/core'
import { projectsService } from './service/projects'

export const sendReminder = defineJob('projects:send-reminder',
  async (data: { taskId: string }) => {
    await projectsService().notifyAssignee(data.taskId)
  },
)
```

Schedule from handlers or services: `ctx.scheduler.add('projects:send-reminder', { taskId }, { delay: '1d' })`. Retries, cron scheduling, and priority queues — all Postgres-backed via pg-boss.

</details>

<details>
<summary><b>agent slot example</b> — tools, materializers, AGENTS.md fragments</summary>

```typescript
// modules/projects/agent.ts
import { defineAgentTool, defineIndexContributor } from '@vobase/core'
import { projectsService } from './service/projects'

const createTask = defineAgentTool({
  name: 'create_task',
  audience: 'internal',
  lane: 'standalone',
  // schema: zod input/output…
  async handler({ input, ctx }) {
    return await projectsService().createTask(input)
  },
})

export const projectsAgent = {
  agentsMd: [defineIndexContributor({
    file: 'AGENTS.md',
    priority: 50,
    name: 'projects.overview',
    render: () => '## Projects\n\n- `create_task` to add a task to a project.',
  })],
  materializers: [/* WorkspaceMaterializerFactory<WakeContext>[] */],
  roHints: [/* explain why /projects/<id>/* paths are read-only */],
  tools: [createTask],
}
```

The wake builder filters tools by `lane` and `audience`, runs each materializer factory against the wake context, chains roHints, and feeds the AGENTS.md contributors into the harness. One agent slot per module — no central registry to update.

</details>

---

### the ctx object

Every HTTP handler gets a context object with runtime capabilities. Current surface:

| Property | What it does |
|---|---|
| `ctx.db` | Drizzle instance. Full PostgreSQL — reads, writes, transactions. |
| `ctx.user` | `{ id, email, name, role, activeOrganizationId? }`. From better-auth session. RBAC middlewares: `requireRole()`, `requirePermission()`, `requireOrg()`. |
| `ctx.scheduler` | Job queue. `add(jobName, data, options)` to schedule background work. |
| `ctx.storage` | `StorageService` — virtual buckets with local/S3/R2 backends. |
| `ctx.channels` | `ChannelsService` — email and WhatsApp sends. All messages logged. |
| `ctx.integrations` | Encrypted credential vault. `ctx.integrations.getActive(provider)` returns decrypted config or null. |
| `ctx.http` | Typed HTTP client with retries, timeouts, and circuit breakers. |
| `ctx.realtime` | `RealtimeService` — `notify({ table, id?, action? }, tx?)` after mutations. SSE subscribers receive the event; the frontend hook invalidates matching TanStack queries. |

Modules can declare an `init(ctx: ModuleInitCtx)` hook that runs at boot with `{ db, realtime, jobs, scheduler, auth, cli }`. Cross-module callers `import` from `@modules/<name>/service/*` directly — no port shim, no plugin system. Unconfigured services use throw-proxies that produce descriptive errors if accessed.

App-level config:

```typescript
// vobase.config.ts
export default defineConfig({
  database: process.env.DATABASE_URL,
  integrations: { enabled: true },      // opt-in: encrypted credential store
  storage: {                            // opt-in: file storage
    provider: { type: 'local', basePath: './data/files' },
    buckets: { avatars: { maxSize: 5_000_000 }, documents: {} },
  },
  channels: {                           // opt-in: email + WhatsApp
    email: { provider: 'resend', from: 'noreply@example.com', resend: { apiKey: '...' } },
  },
  http: {
    timeout: 10_000,
    retries: 3,
    circuitBreaker: { threshold: 5, resetTimeout: 30_000 },
  },
  webhooks: {
    'stripe-events': {
      path: '/webhooks/stripe',
      secret: process.env.STRIPE_WEBHOOK_SECRET,
      handler: 'system:processWebhook',
      signatureHeader: 'stripe-signature',
      dedup: true,
    },
  },
})
```

Credentials stay in `.env`. Config declares the shape.

---

### agent harness

The harness is the AI runtime in core. It runs on top of `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai` and ships as `createHarness({...})` from `@vobase/core`. Each "wake" is one bounded run of an agent over a frozen system prompt.

**Lanes** — the template ships two:

- **Conversation** — bound to `(contactId, channelInstanceId, conversationId)`. Triggered by `inbound_message`, `supervisor`, `approval_resumed`, `scheduled_followup`, `manual`.
- **Standalone** — operator threads + heartbeats. Triggered by `operator_thread`, `heartbeat`. Customer-facing tools are filtered out.

**Invariants** baked into core:

- *Frozen snapshot.* System prompt computed once at `agent_start`; the `systemHash` is identical every turn so the provider's prefix cache stays warm. Mid-wake writes surface in the next turn's side-load.
- *Steer/abort between turns.* Customer messages append to the steer queue and drain after `tool_execution_end`. Supervisor and approval-resumed events hard-abort and re-wake.
- *Tool stdout budget.* 4KB inline → 100KB spill (`/tmp/tool-<callId>.txt`) → 200KB turn ceiling.
- *Idle resumption + restart recovery.* The harness recovers orphaned dispatches on boot and resumes idle wakes via journaled events.
- *Cost cap.* Daily-spend tracking + per-org evaluation gate.

**Workspace** — every wake runs against a virtual filesystem materialized from your modules. AGENTS.md is composed from each module's `agentsMd` contributor (plus per-tool guidance). Read-only paths are enforced at the FS boundary via `ScopedFs`. Memory writes (`/contacts/<id>/MEMORY.md`, `/agents/<id>/MEMORY.md`, `/staff/<id>/MEMORY.md`) flush at turn end.

**LLM provider** — one seam. Bifrost when `BIFROST_API_KEY` + `BIFROST_URL` are set, otherwise direct OpenAI / Anthropic / Google. Use `createModel(alias)` from the template's `~/wake`; never hardcode a provider-prefixed id.

**Testing** — pass `streamFn: stubStreamFn([...])` (inline `AssistantMessageEvent[]` per LLM call) to `bootWake` to keep tests off real providers. Live smoke tests under `tests/smoke/` exercise real keys.

---

### vs the alternatives

| | **Vobase** | **Supabase** | **Pocketbase** | **Rails / Laravel** |
|---|---|---|---|---|
| What you get | Full-stack scaffold (backend + frontend + agent harness + skills) | Backend-as-a-service (db + auth + storage + functions) | Backend binary (db + auth + storage + API) | Full-stack framework |
| Language | TypeScript end-to-end | TypeScript (client) + PostgreSQL | Go (closed binary) | Ruby / PHP |
| Database | PostgreSQL (Docker Compose local, managed prod) | PostgreSQL (managed) | SQLite (embedded) | PostgreSQL / MySQL |
| Self-hosted | One process, one container | [10+ Docker containers](https://supabase.com/docs/guides/self-hosting/docker) | One binary | Multi-process |
| You own the code | Yes — all source in your project | No — managed service | No — compiled binary | Yes — but no AI conventions |
| AI agent runtime | First-class harness (frozen prompts, tool budget, steer/abort) | Edge functions only | None | None |
| AI integration | Skills + MCP + canonical module shape | None | None | None |
| How you customize | Edit the code. AI reads it. | Dashboard + RLS policies | Admin UI + hooks | Edit the code |
| Hosting cost | As low as $15/mo | $25/mo+ (or complex self-host) | Free (self-host) | Varies |
| Data isolation | Physical (one db per app) | Logical (RLS) | Physical | Varies |
| License | MIT | Apache 2.0 | MIT | MIT |

**vs Supabase:** Self-hosted Supabase is [10+ Docker containers](https://supabase.com/docs/guides/self-hosting/docker). RLS policies are hard to reason about. You don't own the backend code. Vobase is one process, you own every line — AI agents can read and modify everything.

**vs Pocketbase:** Pocketbase is a Go binary. You can see the admin UI, but you can't read or modify the internals. When you need custom business logic, you're writing Go plugins or calling external services. Vobase is TypeScript you own — AI agents understand and extend it natively.

**vs Rails / Laravel:** Great frameworks, but they weren't designed for AI coding agents. Vobase's canonical module shape and skill packs mean AI-generated code follows your patterns consistently. Plus: simpler stack (no Redis, single process, TypeScript end-to-end).

---

### runtime architecture

One Bun process. One Docker container. One app.

```
Docker container (--restart=always)
  └── Bun process (PID 1)
        ├── Hono server
        │     ├── /api/auth/*    → better-auth (sessions, OTP, CSRF)
        │     ├── /api/<mod>/*   → module web routes (session-validated)
        │     ├── /api/cli/*     → CLI catalog + dispatch (HTTP-RPC)
        │     ├── /mcp           → MCP server (same process, shared port)
        │     ├── /webhooks/*    → inbound channel webhooks (signature verified, dedup)
        │     ├── /api/realtime  → SSE stream (LISTEN/NOTIFY → client)
        │     └── /*             → frontend (static, from dist/)
        ├── Drizzle (postgres-js → PostgreSQL)
        ├── Built-in modules (in @vobase/core)
        │     ├── _auth          → better-auth behind AuthAdapter contract
        │     ├── _audit         → audit log, record tracking, auth hooks
        │     ├── _sequences     → gap-free business number counters
        │     ├── _integrations  → encrypted credential vault, platform OAuth handoff (opt-in)
        │     ├── _storage       → virtual buckets, local/S3/R2 (opt-in)
        │     └── _channels      → unified messaging, adapter pattern (opt-in)
        ├── Template modules (in @vobase/template)
        │     ├── settings → contacts → team → drive → messaging
        │     ├── agents → schedules → channels → changes → system
        │     └── wake/  → agent harness seam (conversation + standalone lanes)
        ├── pg-boss (Postgres-backed job queue, pg-boss own schema)
        ├── Outbound HTTP (typed fetch, retries, circuit breakers)
        └── Audit middleware (all mutations → audit_log)
```

---

### mcp server

Runs in the same Bun process on the same port. Authenticated via API keys (better-auth apiKey plugin). When you connect Claude Code, Codex, Cursor, or any MCP-compatible tool, it sees your app:

| Tool | What it does |
|---|---|
| `list_modules` | List all registered modules (built-in + user) |
| `read_module` | Read table names from a specific module schema |
| `get_schema` | List all table names across every module |
| `view_logs` | Return recent audit log entries |

The AI sees your exact data model, your existing modules, and the conventions before it writes a single line of code.

---

### deployment

Ship a Docker image. Railway, Fly.io, or any Docker host. Set `DATABASE_URL` for a managed Postgres connection.

**Railway (quickest):**

```bash
railway up
```

The template ships with `Dockerfile` and `railway.json` pre-configured. Add a Postgres plugin and Railway sets `DATABASE_URL` automatically.

**Docker Compose:**

```yaml
# docker-compose.yml
services:
  vobase:
    image: your-registry/my-vobase:latest
    restart: always
    environment:
      DATABASE_URL: postgres://user:pass@db:5432/vobase
    ports:
      - "3000:3000"
  db:
    image: pgvector/pgvector:pg17
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: vobase
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
volumes:
  pgdata:
```

---

### project commands

After scaffolding, your project uses standard tools directly — no wrapper CLI:

| Command | What it does |
|---|---|
| `docker compose up -d` | Start local Postgres (pgvector/pg17, port 5432). |
| `bun run dev` | Bun backend with `--hot` and Vite frontend, both via `concurrently`. |
| `bun run db:push` | Push schema to database (dev). |
| `bun run db:generate` | Generate migration files for production. |
| `bun run db:migrate` | Run migrations against the database. |
| `bun run db:seed` | Seed default admin user and sample data. |
| `bun run db:reset` | Nuke + push + seed. |
| `bun run db:studio` | Drizzle Studio for visual database browsing. |
| `bun run check` | Run every `check:*` (`shape`, `bundle`, `no-auto-nav-tabs`, `shadcn-overrides`). |
| `bun run test` | Full test suite. `test:e2e` / `test:smoke` for live integration. |

---

### project structure

```
my-app/
  .env
  .env.example
  package.json            ← depends on @vobase/core
  docker-compose.yml      ← local Postgres (pgvector/pg17)
  drizzle.config.ts
  vite.config.ts
  index.html
  main.ts                 ← ~10-line Bun.serve entry
  CLAUDE.md               ← project context and guardrails
  AGENTS.md               ← agent guardrails (mirrors CLAUDE.md)
  .claude/
    skills/               ← skill packs the AI reads when generating code
  auth/                   ← better-auth + plugins
  runtime/
    index.ts              ← cross-module primitives, ModuleDef/ModuleInitCtx
    bootstrap.ts          ← createApp(), worker registration
    modules.ts            ← static list of modules
  wake/                   ← agent harness seam (top-level)
    conversation.ts       ← conversation lane builder
    standalone.ts         ← standalone lane builder
    inbound.ts            ← channels:inbound-to-wake handler
    supervisor.ts         ← messaging:supervisor-to-wake handler
    operator-thread.ts    ← agents:operator-thread-to-wake handler
    heartbeat.ts          ← schedules cron-tick callback
    llm.ts                ← Bifrost / direct provider seam
    trigger.ts            ← WakeTriggerKind registry
    workspace/            ← per-wake virtual FS materializers
    observers/            ← workspace-sync, journal, etc.
  modules/
    settings/             ← notification prefs, per-user UI state
    contacts/             ← customer records + /contacts/<id>/MEMORY.md
    team/                 ← staff directory + attributes
    drive/                ← virtual filesystem; modules register overlays
    messaging/            ← conversations, messages, notes, supervisor fan-out
    agents/               ← definitions, learned skills, staff memory, scores
    schedules/            ← agent_schedules + cron heartbeats
    channels/             ← umbrella for adapters/{web,whatsapp,...}
    changes/              ← generic propose/decide/apply/history
    system/               ← ops dashboard, dev helpers
    <each module>/
      module.ts           ← thin aggregator
      schema.ts
      state.ts
      service/            ← sole writer of this module's tables
      handlers/
      web.ts
      pages/              ← React pages (TanStack file-based routes)
      components/
      hooks/
      jobs.ts
      agent.ts            ← tools, materializers, roHints, AGENTS.md fragments
      tools/              ← defineAgentTool
      verbs/              ← defineCliVerb
      cli.ts              ← <module>Verbs barrel
      seed.ts
      defaults/           ← *.agent.yaml, *.schedule.yaml
      skills/             ← inline skill bodies
  src/                    ← frontend shell only
    main.tsx
    routeTree.gen.ts      ← generated TanStack route tree
    lib/
      api-client.ts       ← Hono RPC client
    components/
      ui/                 ← shadcn/ui (owned by you)
      ai-elements/        ← AI chat UI components (owned by you)
      data-table/         ← DiceUI data-table components
    shell/
      app-layout.tsx      ← main app shell with sidebar
      command-palette.tsx
      auth/
      settings/
    hooks/
    styles/
    stores/
  tests/
    e2e/                  ← real Postgres
    smoke/                ← live server, real LLM key
  data/
    files/                ← optional, created on first upload
```

---

## Star History

<a href="https://www.star-history.com/?repos=vobase%2Fvobase&type=timeline&logscale=&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=vobase/vobase&type=timeline&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=vobase/vobase&type=timeline&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=vobase/vobase&type=timeline&legend=top-left" />
 </picture>
</a>

<p align="center">
<img src="https://i.imgur.com/I5EeSBh.png">
Star if the repo has helped you
</p>

---

### license

MIT. Own everything.
