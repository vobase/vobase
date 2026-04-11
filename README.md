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
  <a href="#agent-skills">skills</a> ·
  <a href="#vs-the-alternatives">compare</a> ·
  <a href="https://docs.vobase.dev">docs</a>
</p>

---

A full-stack TypeScript framework that gives you auth, database, storage, and jobs in a single process. Docker Compose Postgres for local dev, managed Postgres in production. Like a self-hosted Supabase — but you own every line of code. Like Pocketbase — but it's TypeScript you can read and modify.

AI coding agents (Claude Code, Cursor, Codex) understand vobase out of the box. Strict conventions and agent skills mean generated code works on the first try — not the third.

You own the code. You own the data. You own the infrastructure.

---

### what you get

One `bun create vobase` and you have a working full-stack app:

| Primitive | What it does |
|---|---|
| **Runtime** | **Bun** — native TypeScript, ~50ms startup, built-in test runner. One process, one container. |
| **Database** | **PostgreSQL** via **Drizzle**. Docker Compose Postgres (pgvector/pg17) for local dev, managed Postgres in production. Full SQL, ACID transactions, pgvector for embeddings. |
| **Auth** | **better-auth**. Sessions, passwords, CSRF. RBAC with role guards, API keys, and optional organization/team support. Org/SSO/2FA as plugins. |
| **API** | **Hono** — ~14KB, typed routing, Bun-first. Every AI coding tool already knows Hono. |
| **Audit** | Built-in audit log, record change tracking, and auth event hooks. Every mutation is traceable. |
| **Sequences** | Gap-free business number generation (INV-0001, PO-0042). Transaction-safe, never skips. |
| **Storage** | File storage with virtual buckets. Local or S3 backends. Metadata tracked in Postgres. |
| **Channels** | Multi-channel messaging with pluggable adapters. WhatsApp (Cloud API), email (Resend, SMTP). Inbound webhooks, outbound sends, delivery tracking. All messages logged. |
| **Integrations** | Encrypted credential vault for external services (OAuth providers, APIs). AES-256-GCM at rest. Platform-aware: opt-in multi-tenant OAuth handoff via HMAC-signed JWT. |
| **Jobs** | Background tasks with retries, cron, and job chains. **pg-boss** backed — Postgres only, no Redis. |
| **Knowledge Base** | Upload PDF, DOCX, XLSX, PPTX, images, HTML. Auto-extract to Markdown, chunk, embed, and search. Hybrid search with RRF + HyDE. Gemini OCR for scanned docs. |
| **AI Agents** | Declarative agents via [Mastra](https://mastra.ai) inside the `agents` module. Multi-provider (OpenAI, Anthropic, Google). Tools, workflows, memory processors, eval scorers, guardrails. Embedded **Mastra Studio** at `/studio` for dev. Frontend stays on AI SDK `useChat`. |
| **Frontend** | **React + TanStack Router + shadcn/ui + Tailwind v4**. Type-safe routing with codegen, code-splitting. You own the component source — no tailwind.config.js needed. |
| **Skills** | Domain knowledge packs that teach AI agents your app's patterns and conventions. |
| **MCP** | Module-aware tools with API key auth via **@modelcontextprotocol/sdk**. AI tools can read your schema, list modules, and view logs before generating code. Same process, shared port. |
| **Deploy** | Dockerfile + railway.toml included. One `railway up` or `docker build` and you're live. |

Locally, `docker compose up -d` starts a pgvector/pg17 Postgres instance. `bun run dev` and you're building. In production, point `DATABASE_URL` at any managed Postgres instance.

---

### quick start

```bash
bun create vobase my-app
cd my-app
bun run dev
```

Start Postgres with `docker compose up -d`, then backend on `:3000`, frontend on `:5173`. Ships with a dashboard and audit log viewer out of the box.

---

### what you can build

Every module is a self-contained directory: schema, handlers, jobs, pages. No plugins, no marketplace. Just TypeScript you own.

| Use Case | What Ships |
|---|---|
| **SaaS Starter** | User accounts, billing integration, subscription management, admin dashboard. Auth + jobs + webhooks handle the plumbing. |
| **Internal Tools** | Admin panels, operations dashboards, approval workflows. Status machines enforce business logic. Audit trails track every change. |
| **CRM & Contacts** | Companies, contacts, interaction timelines, deal tracking. Cross-module references keep things decoupled. |
| **Project Tracker** | Tasks, assignments, status workflows, notifications. Background jobs handle reminders and escalations. |
| **Billing & Invoicing** | Invoices, line items, payments, aging reports. Integer money ensures exact arithmetic. Gap-free numbering via transactions. |
| **Your Vertical** | Property management, fleet tracking, field services — whatever the business needs. Describe it to your AI tool. It generates the module. |

AI coding agents generate modules from your conventions. Like `npx shadcn add button` — files get copied, you own the code.

---

### how it works

Vobase makes itself legible to every AI coding tool on the market.

The framework ships with strict conventions and **agent skills** — domain knowledge packs that teach AI tools how your app works. When you need a new capability:

1. Open your AI tool and describe the requirement
2. The AI reads your existing schema, module conventions, and the relevant skills
3. It generates a complete module — schema, handlers, jobs, pages, tests, seed data
4. You review the diff, run `bun run dev`, and it works

Skills cover the parts where apps get tricky: money stored as integer cents (never floats), status transitions as explicit state machines (not arbitrary string updates), gap-free business numbers generated inside database transactions (not auto-increment IDs that leave holes).

These conventions are what make AI-generated modules work on the first try.

**The thesis:** your specs and domain knowledge are the asset. AI tools are the compiler. The compiler improves every quarter. Your skills compound forever.

---

### what a module looks like

Every module declares itself through `defineModule()`. This convention is what AI tools rely on to generate correct code.

```typescript
// modules/projects/index.ts
import { defineModule } from '@vobase/core'
import * as schema from './schema'
import { routes } from './handlers'
import { jobs } from './jobs'
import * as pages from './pages'
import seed from './seed'

export default defineModule({
  name: 'projects',
  schema,
  routes,
  jobs,
  pages,
  seed,
  init: (ctx) => {
    // Optional: run setup logic at boot with access to db, scheduler, http, storage, channels
  },
})
```

```
modules/projects/
  schema.ts           ← Drizzle table definitions
  handlers.ts         ← Hono routes (HTTP API)
  handlers.test.ts    ← colocated tests (bun test)
  jobs.ts             ← background tasks (pg-boss, no Redis)
  pages/              ← React pages (list, detail, create)
  seed.ts             ← sample data for dev
  index.ts            ← defineModule()
```

<details>
<summary><b>schema example</b> — Drizzle + PostgreSQL with typed columns, timestamps, status enums</summary>

```typescript
// modules/projects/schema.ts
import { pgTable, text, integer, timestamp } from 'drizzle-orm/pg-core'
import { nanoidPrimaryKey } from '@vobase/core'

export const projects = pgTable('projects', {
  id: nanoidPrimaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').notNull().default('active'),    // active -> archived -> deleted
  owner_id: text('owner_id').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const tasks = pgTable('tasks', {
  id: nanoidPrimaryKey(),
  project_id: text('project_id').references(() => projects.id),
  title: text('title').notNull(),
  status: text('status').notNull().default('todo'),       // todo -> in_progress -> done
  assignee_id: text('assignee_id'),
  priority: integer('priority').notNull().default(0),
})
```

</details>

<details>
<summary><b>handler example</b> — Hono routes with typed context and authorization</summary>

```typescript
// modules/projects/handlers.ts
import { Hono } from 'hono'
import { getCtx } from '@vobase/core'
import { projects } from './schema'

export const routes = new Hono()

routes.get('/projects', async (c) => {
  const ctx = getCtx(c)
  return c.json(await ctx.db.select().from(projects))
})

routes.post('/projects', async (c) => {
  const ctx = getCtx(c)
  const body = await c.req.json()

  const project = await ctx.db.insert(projects).values({
    ...body,
    owner_id: ctx.user.id,
  })

  return c.json(project)
})
```

The frontend gets fully typed API calls via codegen:

```typescript
import { hc } from 'hono/client'
import type { AppType } from './api-types.generated'

const client = hc<AppType>('/')
const res = await client.api.projects.$get()
const projects = await res.json()  // fully typed — autocomplete on every route and response
```

`AppType` is code-generated from your server's route tree, giving you end-to-end type safety from handler return values to frontend consumption.

</details>

<details>
<summary><b>job example</b> — background tasks via pg-boss, no Redis</summary>

```typescript
// modules/projects/jobs.ts
import { defineJob } from '@vobase/core'
import { tasks } from './schema'
import { eq } from 'drizzle-orm'

export const sendReminder = defineJob('projects:sendReminder',
  async (data: { taskId: string }) => {
    const task = await db.select().from(tasks)
      .where(eq(tasks.id, data.taskId))
    // send notification, update status, log the action
  }
)
```

Schedule from handlers: `ctx.scheduler.add('projects:sendReminder', { taskId }, { delay: '1d' })`

Retries, cron scheduling, and priority queues — all Postgres-backed via pg-boss.

</details>

---

### the ctx object

Every HTTP handler gets a context object with runtime capabilities. Current surface:

| Property | What it does |
|---|---|
| `ctx.db` | Drizzle instance. Full PostgreSQL — reads, writes, transactions. |
| `ctx.user` | `{ id, email, name, role, activeOrganizationId? }`. From better-auth session. Used for authorization checks. RBAC middlewares: `requireRole()`, `requirePermission()`, `requireOrg()`. |
| `ctx.scheduler` | Job queue. `add(jobName, data, options)` to schedule background work. |
| `ctx.storage` | `StorageService` — virtual buckets with local/S3 backends. `ctx.storage.bucket('avatars').upload(key, data)`. |
| `ctx.channels` | `ChannelsService` — email and WhatsApp sends. `ctx.channels.email.send(msg)`. All messages logged. |
| `ctx.integrations` | `IntegrationsService` — encrypted credential vault. `ctx.integrations.getActive(provider)` returns decrypted config or null. Platform-managed providers connected via HMAC-signed forwarding. |
| `ctx.http` | Typed HTTP client with retries, timeouts, and circuit breakers. |
| `ctx.realtime` | `RealtimeService` — event-driven server-push via PostgreSQL LISTEN/NOTIFY + SSE. `ctx.realtime.notify({ table, id?, action? }, tx?)` after mutations. |

For jobs, pass dependencies through closures/factories (or import what you need) when calling `defineJob(...)`.

#### module init context

Modules can declare an `init` hook that receives a `ModuleInitContext` at boot — same services as request context (`db`, `scheduler`, `http`, `storage`, `channels`, `realtime`). Unconfigured services use throw-proxies that give descriptive errors if accessed.

#### ctx extensions for external integrations

Beyond local capabilities (database, user, scheduler, storage), `ctx` provides outbound connectivity and inbound event handling:

| Property | What it does |
|---|---|
| `ctx.http` | Typed fetch wrapper with retries, timeouts, circuit breakers, and structured error responses. Configurable per-app via `http` in `vobase.config.ts`. |
| `webhooks` (app-level) | Inbound webhook receiver with HMAC signature verification, deduplication, and automatic enqueue-to-job. Configured in `vobase.config.ts`, mounted as `/webhooks/*` routes — not a ctx property. |

```typescript
// vobase.config.ts
export default defineConfig({
  database: process.env.DATABASE_URL,
  integrations: { enabled: true },      // opt-in: encrypted credential store, provider configs
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
    retryDelay: 500,
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

### vs the alternatives

| | **Vobase** | **Supabase** | **Pocketbase** | **Rails / Laravel** |
|---|---|---|---|---|
| What you get | Full-stack scaffold (backend + frontend + skills) | Backend-as-a-service (db + auth + storage + functions) | Backend binary (db + auth + storage + API) | Full-stack framework |
| Language | TypeScript end-to-end | TypeScript (client) + PostgreSQL | Go (closed binary) | Ruby / PHP |
| Database | PostgreSQL (Docker Compose local, managed prod) | PostgreSQL (managed) | SQLite (embedded) | PostgreSQL / MySQL |
| Self-hosted | One process, one container | [10+ Docker containers](https://supabase.com/docs/guides/self-hosting/docker) | One binary | Multi-process |
| You own the code | Yes — all source in your project | No — managed service | No — compiled binary | Yes — but no AI conventions |
| AI integration | Agent skills + MCP + strict conventions | None | None | None |
| How you customize | Edit the code. AI reads it. | Dashboard + RLS policies | Admin UI + hooks | Edit the code |
| Hosting cost | As low as $15/mo | $25/mo+ (or complex self-host) | Free (self-host) | Varies |
| Data isolation | Physical (one db per app) | Logical (RLS) | Physical | Varies |
| License | MIT | Apache 2.0 | MIT | MIT |

**vs Supabase:** Self-hosted Supabase is [10+ Docker containers](https://supabase.com/docs/guides/self-hosting/docker). RLS policies are hard to reason about. You don't own the backend code. Vobase is one process, you own every line — AI agents can read and modify everything.

**vs Pocketbase:** Pocketbase is a Go binary. You can see the admin UI, but you can't read or modify the internals. When you need custom business logic, you're writing Go plugins or calling external services. Vobase is TypeScript you own — AI agents understand and extend it natively.

**vs Rails / Laravel:** Great frameworks, but they weren't designed for AI coding agents. Vobase's strict conventions and agent skills mean AI-generated code follows your patterns consistently. Plus: simpler stack (no Redis, single process, TypeScript end-to-end).

---

### runtime architecture

One Bun process. One Docker container. One app.

```
Docker container (--restart=always)
  └── Bun process (PID 1)
        ├── Hono server
        │     ├── /auth/*       → better-auth (sessions, passwords, CSRF)
        │     ├── /api/*        → module handlers (session-validated)
        │     ├── /api/agents/*  → Mastra agent/tool/workflow API
        │     ├── /studio       → Mastra Studio SPA (dev-only)
        │     ├── /mcp          → MCP server (same process, shared port)
        │     ├── /webhooks/*   → inbound event receiver (signature verified, dedup)
        │     └── /*            → frontend (static, from dist/)
        ├── Drizzle (bun:sql → PostgreSQL)
        ├── Built-in modules
        │     ├── _auth         → better-auth behind AuthAdapter contract
        │     ├── _audit        → audit log, record tracking, auth hooks
        │     ├── _sequences    → gap-free business number counters
        │     ├── _integrations → encrypted credential vault, platform OAuth handoff (opt-in)
        │     ├── _storage      → virtual buckets, local/S3 (opt-in)
        │     └── _channels     → unified messaging, adapter pattern (opt-in)
        ├── pg-boss (Postgres-backed job queue)
        ├── Outbound HTTP (typed fetch, retries, circuit breakers)
        └── Audit middleware (all mutations → _audit_log)
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

The template ships with `Dockerfile` and `railway.toml` pre-configured. Add a Postgres plugin and Railway sets `DATABASE_URL` automatically.

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
    image: postgres:17
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
| `bun run dev` | Start Bun backend with `--watch` and Vite frontend. Auto-restarts on changes. |
| `docker compose up -d` | Start local Postgres (pgvector/pg17, port 5432). |
| `bun run db:push` | Apply fixtures then push schema to database (dev). |
| `bun run db:generate` | Generate migration files for production. |
| `bun run db:migrate` | Run migrations against the database. |
| `bun run db:seed` | Seed default admin user and sample data. |
| `bun run db:reset` | Drop and recreate database, push schema, and seed. |
| `bun run db:studio` | Open Drizzle Studio for visual database browsing. |

---

### project structure

```
my-app/
  .env
  .env.example
  package.json            ← depends on @vobase/core
  docker-compose.yml      ← local Postgres (pgvector/pg17)
  drizzle.config.ts
  vobase.config.ts        ← database URL, auth, connections, webhooks
  vite.config.ts          ← Vite + TanStack Router + path aliases
  index.html
  server.ts               ← createApp() entry
  AGENTS.md               ← project context and guardrails (CLAUDE.md symlinks here)
  .agents/
    skills/
      integer-money/
        SKILL.md          ← core: all money as integer cents
  modules/
    messaging/            ← conversations, contacts, channels, labels, state machine
      index.ts            ← defineModule()
      schema.ts           ← conversations, messages, contacts, channels, labels, etc.
      handlers/           ← conversations, contacts, channels, labels, activity
      jobs.ts             ← outbox delivery, channel sessions
      lib/                ← state machine, channel reply, delivery, inbound
      pages/              ← inbox, conversations, contacts, channels, labels
      seed.ts             ← demo data
    agents/               ← AI agents, evals, guardrails, memory, MCP
      index.ts            ← defineModule()
      schema.ts           ← moderation_logs (scorers use Mastra native storage)
      handlers/           ← chat, agents, evals, guardrails, memory, metrics, MCP
      jobs.ts             ← agent wake
      mastra/             ← Mastra primitives
        index.ts          ← Mastra singleton: initMastra(), getMastra(), getMemory()
        studio.ts         ← dev-only Studio SPA middleware
        agents/           ← agent definitions (Mastra Agent instances)
        tools/            ← RAG tools, booking, conversation tools
        processors/       ← input/output processors, moderation guardrail
        evals/            ← code scorers, custom scorer factory
        mcp/              ← AI module MCP server
        storage/          ← VobaseMemoryStorage (hybrid Mastra + Vobase)
        lib/              ← DI, model aliases, observability
      pages/              ← evals dashboard, guardrails, memory
    automation/           ← browser task automation
      index.ts
      pages/
    system/               ← ops dashboard
      index.ts            ← defineModule()
      handlers.ts         ← health, audit log, sequences, record audits
      pages/
    knowledge-base/       ← document ingestion + hybrid search
      index.ts
      schema.ts
      handlers.ts
      jobs.ts             ← async document processing via queue
      lib/                ← extract, chunk, embed, search pipeline
      pages/
    integrations/         ← external service credential management
      index.ts
      handlers.ts
      jobs.ts
    index.ts              ← module registry
    your-module/          ← modules you add
      index.ts            ← defineModule()
      schema.ts
      handlers.ts
      jobs.ts
      pages/
  src/
    main.tsx
    home.tsx
    root.tsx
    routeTree.gen.ts      ← generated TanStack route tree
    lib/
    components/
      ui/                 ← shadcn/ui (owned by you)
      ai-elements/        ← AI chat UI components (owned by you)
      chat/               ← chat-specific components
      data-table/         ← DiceUI data-table components
    shell/
      app-layout.tsx      ← main app shell with sidebar
      shell-header.tsx
      command-palette.tsx
      auth/               ← login, signup
      settings/           ← user, org, API keys, integrations settings
    hooks/
    styles/
    stores/
    types/
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
