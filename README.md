<p align="center">
  <b>vobase</b><br>
  The app framework built for AI coding agents.<br>
  Own every line. Your AI already knows how to build on it.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@vobase/core"><img src="https://img.shields.io/npm/v/@vobase/core.svg" alt="npm @vobase/core"></a>
  <a href="https://www.npmjs.com/package/@vobase/core"><img src="https://img.shields.io/npm/dm/@vobase/core.svg" alt="npm downloads"></a>
  <a href="https://github.com/vobase/vobase"><img src="https://img.shields.io/github/stars/vobase/vobase" alt="GitHub stars"></a>
  <a href="https://github.com/vobase/vobase/commits/main"><img src="https://img.shields.io/github/last-commit/vobase/vobase" alt="Last commit"></a>
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License MIT">
  <br>
  <img src="https://img.shields.io/badge/Bun-1.3.10-black?logo=bun" alt="Bun 1.3.10">
  <img src="https://img.shields.io/badge/TypeScript-strict-blue.svg" alt="TypeScript">
  <img src="https://img.shields.io/badge/Database-SQLite-07405e?logo=sqlite" alt="SQLite">
  <img src="https://img.shields.io/badge/Auth-better--auth-16a34a" alt="better-auth">
  <img src="https://img.shields.io/badge/Deployment-self--hosted-0ea5e9" alt="Self-hosted">
  <a href="https://discord.gg/sVsPBHtvTZ"><img 
  src="https://img.shields.io/badge/discord-join-5865F2?logo=discord&logoColor=white"               
  alt="Discord"></a>
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

A full-stack TypeScript framework that gives you auth, database, storage, and jobs in a single process with a single SQLite file. Like a self-hosted Supabase — but you own every line of code. Like Pocketbase — but it's TypeScript you can read and modify.

AI coding agents (Claude Code, Cursor, Codex) understand vobase out of the box. Strict conventions and agent skills mean generated code works on the first try — not the third.

You own the code. You own the data. You own the infrastructure.

---

### what you get

One `bun create vobase` and you have a working full-stack app:

| Primitive | What it does |
|---|---|
| **Database** | SQLite via Drizzle. Real SQL with JOINs, transactions, migrations. One `.db` file. |
| **Auth** | better-auth. Sessions, passwords, CSRF. RBAC with role guards, API keys, and optional organization/team support. Works out of the box. |
| **Audit** | Built-in audit log, record change tracking, and auth event hooks. Every mutation is traceable. |
| **Sequences** | Gap-free business number generation (INV-0001, PO-0042). Transaction-safe, never skips. |
| **Storage** | File storage with virtual buckets. Local or S3 backends. Metadata tracked in SQLite. |
| **Notify** | Email (Resend, SMTP) and WhatsApp (WABA) channels. All sends logged. |
| **Jobs** | Background tasks with retries, cron, and job chains. SQLite-backed, no Redis. |
| **Frontend** | React + TanStack Router + shadcn/ui. Type-safe routing, code-splitting, you own the components. |
| **Skills** | Domain knowledge packs that teach AI agents your app's patterns and conventions. |
| **MCP** | Module-aware CRUD tools with API key auth. AI tools can read your schema, query data, and modify records before generating code. |

Everything runs in one Bun process. No Docker fleet. No external services. `bun run dev` and you're building.

---

### quick start

```bash
bun create vobase my-app
cd my-app
bun run dev
```

Backend on `:3000`, frontend on `:5173`. Ships with a dashboard and audit log viewer out of the box.

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

Module starters ship as skills: `vobase add skill <name>`. Like `npx shadcn add button` — files get copied, you own the code.

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
    // Optional: run setup logic at boot with access to db, scheduler, http, storage, notify
  },
})
```

```
modules/projects/
  schema.ts           ← Drizzle table definitions
  handlers.ts         ← Hono routes (HTTP API)
  handlers.test.ts    ← colocated tests (bun test)
  jobs.ts             ← background tasks (SQLite-backed, no Redis)
  pages/              ← React pages (list, detail, create)
  seed.ts             ← sample data for dev
  index.ts            ← defineModule()
```

<details>
<summary><b>schema example</b> — Drizzle + SQLite with typed columns, timestamps, status enums</summary>

```typescript
// modules/projects/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { nanoidPrimaryKey } from '@vobase/core'

export const projects = sqliteTable('projects', {
  id: nanoidPrimaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').notNull().default('active'),    // active -> archived -> deleted
  owner_id: text('owner_id').notNull(),
  created_at: integer('created_at', { mode: 'timestamp_ms' })
    .notNull().$defaultFn(() => new Date()),
})

export const tasks = sqliteTable('tasks', {
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

The frontend gets typed API calls for free via Hono RPC:

```typescript
import { hc } from 'hono/client'
import type { AppType } from '../server'

const client = hc<AppType>('/')
const res = await client.api.projects.$get()
const projects = await res.json()  // fully typed, no codegen
```

</details>

<details>
<summary><b>job example</b> — background tasks, SQLite-backed, no Redis</summary>

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

Retries, cron scheduling, and job dependencies via FlowProducer (chains, DAGs, parallel fan-out/fan-in) — all SQLite-backed, 286K ops/sec.

</details>

---

### the ctx object

Every HTTP handler gets a context object with runtime capabilities. Current surface:

| Property | What it does |
|---|---|
| `ctx.db` | Drizzle instance. Full SQL via bun:sqlite — reads, writes, transactions. |
| `ctx.user` | `{ id, email, name, role, activeOrganizationId? }`. From better-auth session. Used for authorization checks. RBAC middlewares: `requireRole()`, `requirePermission()`, `requireOrg()`. |
| `ctx.scheduler` | Job queue. `add(jobName, data, options)` to schedule background work. |
| `ctx.storage` | `StorageService` — virtual buckets with local/S3 backends. `ctx.storage.bucket('avatars').upload(key, data)`. |
| `ctx.notify` | `NotifyService` — email and WhatsApp channels. `ctx.notify.email.send(msg)`. All sends logged. |
| `ctx.http` | Typed HTTP client with retries, timeouts, and circuit breakers. |

For jobs, pass dependencies through closures/factories (or import what you need) when calling `defineJob(...)`.

#### module init context

Modules can declare an `init` hook that receives a `ModuleInitContext` at boot — same services as request context (`db`, `scheduler`, `http`, `storage`, `notify`). Unconfigured services use throw-proxies that give descriptive errors if accessed.

#### ctx extensions for external integrations

Beyond local capabilities (database, user, scheduler, storage), `ctx` provides outbound connectivity and inbound event handling:

| Property | What it does |
|---|---|
| `ctx.http` | Typed fetch wrapper with retries, timeouts, circuit breakers, and structured error responses. Configurable per-app via `http` in `vobase.config.ts`. |
| `webhooks` (app-level) | Inbound webhook receiver with HMAC signature verification, deduplication, and automatic enqueue-to-job. Configured in `vobase.config.ts`, mounted as `/webhooks/*` routes — not a ctx property. |

```typescript
// vobase.config.ts
export default defineConfig({
  database: './data/vobase.db',
  credentials: { enabled: true },      // opt-in: encrypted credential store
  storage: {                            // opt-in: file storage
    provider: { type: 'local', basePath: './data/files' },
    buckets: { avatars: { maxSize: 5_000_000 }, documents: {} },
  },
  notify: {                             // opt-in: email + WhatsApp
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

### agent skills

Agent skills are the domain knowledge layer. AI tools load skills before generating code. Skill quality determines code quality — these conventions are what separate working modules from broken ones.

Vobase skills use the same format as [Claude's native skill system](https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills). A skill is a `SKILL.md` file in `.agents/skills/<name>/` with optional bundled resources. Claude (and any compatible AI tool) automatically discovers and loads them through progressive disclosure.

Skills fall into two layers:

#### core skills — app patterns that apply across every module

These are the rules that prevent the most common mistakes. Every module follows them.

| Skill | What it encodes |
|---|---|
| `gap-free-sequences` | Transaction-safe gap-free sequence generation for business numbers (INV-0001, PO-0042). Never use auto-increment IDs as business numbers — they leave holes when transactions roll back. |
| `integer-money` | All money as integer cents. Column: `amount_cents`. Display: `(cents / 100).toFixed(2)`. Safe to $90 billion. Never floats — IEEE 754 rounding will cost real money at scale. |
| `status-machines` | Explicit finite state machines for document workflows (`draft → sent → paid → void`) with validated transitions in handler code. No arbitrary string updates. |

#### domain skills — industry and vertical-specific logic

These encode domain knowledge for a particular business function, industry, or regulatory environment. Each skill teaches the AI how that domain actually works.

| Skill | What it encodes |
|---|---|
| `sg-gst` | Singapore GST 9% rate, reverse charge, exemption handling, IRAS filing requirements, rounding policy. |
| `sg-invoicing` | Tax invoice mandatory fields, credit note linkage, InvoiceNow/Peppol readiness, UEN validation. |
| `sg-payroll` | CPF contribution rates, SDL/SHG levies, deduction ordering, payslip requirements, IR8A preparation. |

More verticals coming. Write your own following the same format.

---

### skill quality — test, measure, refine

Skills are only as good as the code they produce. Vobase uses [Claude's skill-creator system](https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills) to test and improve skills systematically.

The process:

1. **Write the skill** — `SKILL.md` with instructions, references, scripts
2. **Write test prompts** — real requests users would make
3. **Define assertions** — concrete checks on the generated code
4. **Run evals** — Claude generates code with the skill loaded, assertions grade the output
5. **Benchmark** — pass rate, token usage, elapsed time across multiple runs
6. **Iterate** — rewrite the skill, run again, compare

```bash
bun run eval gap-free-sequences             # run all test prompts against the skill
bun run eval:benchmark gap-free-sequences   # 5 runs with variance analysis
bun run eval:compare gap-free-sequences     # blind A/B: skill vs no-skill
```

The comparator runs blind A/B tests — one agent with the skill, one without, a third agent grades which output is better without knowing which had the skill. If the skill doesn't consistently win, it needs rewriting.

---

### vs the alternatives

| | **Vobase** | **Supabase** | **Pocketbase** | **Rails / Laravel** |
|---|---|---|---|---|
| What you get | Full-stack scaffold (backend + frontend + skills) | Backend-as-a-service (db + auth + storage + functions) | Backend binary (db + auth + storage + API) | Full-stack framework |
| Language | TypeScript end-to-end | TypeScript (client) + PostgreSQL | Go (closed binary) | Ruby / PHP |
| Database | SQLite (one file) | PostgreSQL (managed) | SQLite (embedded) | PostgreSQL / MySQL |
| Self-hosted | One process, one container | [10+ Docker containers](https://supabase.com/docs/guides/self-hosting/docker) | One binary | Multi-process |
| You own the code | Yes — all source in your project | No — managed service | No — compiled binary | Yes — but no AI conventions |
| AI integration | Agent skills + MCP + strict conventions | None | None | None |
| How you customize | Edit the code. AI reads it. | Dashboard + RLS policies | Admin UI + hooks | Edit the code |
| Hosting cost | As low as $15/mo | $25/mo+ (or complex self-host) | Free (self-host) | Varies |
| Data isolation | Physical (one db per app) | Logical (RLS) | Physical | Varies |
| License | MIT | Apache 2.0 | MIT | MIT |

**vs Supabase:** Self-hosted Supabase is [10+ Docker containers](https://supabase.com/docs/guides/self-hosting/docker). RLS policies are hard to reason about. You don't own the backend code. Vobase is one process, one SQLite file, and you own every line — AI agents can read and modify everything.

**vs Pocketbase:** Pocketbase is a Go binary. You can see the admin UI, but you can't read or modify the internals. When you need custom business logic, you're writing Go plugins or calling external services. Vobase is TypeScript you own — AI agents understand and extend it natively.

**vs Rails / Laravel:** Great frameworks, but they weren't designed for AI coding agents. Vobase's strict conventions and agent skills mean AI-generated code follows your patterns consistently. Plus: simpler stack (SQLite, no Redis, single process, TypeScript end-to-end).

---

### runtime architecture

One Bun process. One Docker container. One app.

```
Docker container (--restart=always)
  └── Bun process (PID 1)
        ├── Hono server
        │     ├── /auth/*       → better-auth (sessions, passwords, CSRF)
        │     ├── /api/*        → module handlers (session-validated)
        │     ├── /mcp          → MCP server (same process, shared port)
        │     ├── /webhooks/*   → inbound event receiver (signature verified, dedup)
        │     └── /*            → frontend (static, from dist/)
        ├── Drizzle (bun:sqlite, single file in /data/)
        │     └── WAL mode, 5s busy timeout, foreign keys ON
        ├── Built-in modules
        │     ├── _auth         → better-auth behind AuthAdapter contract
        │     ├── _audit        → audit log, record tracking, auth hooks
        │     ├── _sequences    → gap-free business number counters
        │     ├── _credentials  → encrypted credential store (opt-in)
        │     ├── _storage      → virtual buckets, local/S3 (opt-in)
        │     └── _notify       → email + WhatsApp channels (opt-in)
        ├── bunqueue (SQLite-backed job queue, 286K ops/sec)
        ├── Outbound HTTP (typed fetch, retries, circuit breakers)
        └── Audit middleware (all mutations → _audit_log)
```

---

### tech stack

| Layer | Choice | Why this, not that |
|---|---|---|
| Runtime | **Bun** | Native TypeScript, ~50ms startup, built-in SQLite via bun:sqlite, built-in test runner. |
| Database | **SQLite** via Drizzle | Real SQL with JOINs and aggregations. ACID transactions. One .db file. Zero external dependencies. |
| Auth | **better-auth** | 12K+ stars, SQLite-native, session/JWT, password hashing, CSRF. Org/RBAC/SSO/2FA as plugins. |
| API | **Hono** | ~14KB, typed routing, Bun-first. Every AI coding tool already knows Hono. |
| ORM | **Drizzle** | Type-safe SQL, bun-sqlite adapter, migration generation via drizzle-kit. |
| Jobs | **bunqueue** | Bun-native, SQLite-backed, BullMQ-compatible API. 286K ops/sec, retries, cron, FlowProducer. No Redis. |
| MCP | **@modelcontextprotocol/sdk** | Official SDK. Tools, resources, prompts, SSE. Same process, shared port. |
| Frontend | **React + TanStack** | Router (virtual file routes), Query, Table. Pure SPA, no SSR. Auto code-splitting. |
| Components | **shadcn/ui + Tailwind v4** | You own the component source. v4's CSS-based config means no tailwind.config.js. |
| Backups | **Litestream** | Continuous WAL streaming to S3. ~1 second RPO. Point-in-time recovery. ~$0.03/month. |

---

### why sqlite

At 10-200 concurrent users per instance, SQLite with WAL mode outperforms Postgres. PocketBase, Directus, and Strapi all run on it. This isn't a prototype choice — it's an architecture decision.

Backup your entire system:

```bash
cp vobase.db backup.db
```

Clone production for staging:

```bash
cp data/vobase.db data/staging.db
DATABASE=./data/staging.db PORT=3001 bun run dev
```

One file copy. Exact production clone. No database dump/restore, no connection string changes.

Disaster recovery via Litestream — continuous WAL streaming to S3, roughly one second of lag:

```bash
litestream restore -o /data/vobase.db -timestamp 2026-03-01T10:00:00Z s3://my-backups/instance-id
```

Cost: $0.03-0.05/month. Point-in-time recovery to any second.

---

### mcp server

Runs in the same Bun process on the same port. Authenticated via API keys (better-auth apiKey plugin). When you connect Claude Code, Codex, Cursor, or any MCP-compatible tool, it sees everything:

| Category | What's Exposed |
|---|---|
| **Read** | `list_modules`, `read_module`, `get_schema`, `view_logs` |
| **CRUD** | Module-aware `list`, `get`, `create`, `update`, `delete` tools auto-generated from your Drizzle schema |
| **Query** | `query_db`, `run_smoke_test` |
| **Context** | Schema definitions, module signatures, ctx API docs, recent errors, domain knowledge from skills |

The AI sees your exact data model, your existing modules, and the conventions before it writes a single line of code. CRUD tools are generated per-module — an AI tool can list invoices, create a project, or update a task record directly through MCP.

---

### deployment

Ship a Docker image. Add Caddy for HTTPS. Done.

```yaml
# docker-compose.yml
services:
  vobase:
    image: your-registry/my-vobase:latest
    restart: always
    volumes:
      - vobase_data:/data
    ports:
      - "3000:3000"
    logging:
      driver: "json-file"
      options:
        max-size: "50m"
        max-file: "3"
  caddy:
    image: caddy:latest
    ports:
      - "80:80"
      - "443:443"
```

Litestream wraps the Bun process for continuous backup:

```dockerfile
COPY litestream.yml /etc/litestream.yml
ENTRYPOINT ["litestream", "replicate", "-exec", "bun run server.ts"]
```

Every app gets its own container, its own database, its own backup stream. Physical isolation, not row-level security policies.

---

### project commands

After scaffolding, your project uses standard tools directly — no wrapper CLI:

| Command | What it does |
|---|---|
| `bun run dev` | Start Bun backend with `--watch` and Vite frontend. Auto-restarts on changes. |
| `bun run db:push` | Push schema to SQLite (dev). No migrations needed. |
| `bun run db:generate` | Generate migration files for production. |
| `bun run db:migrate` | Run migrations against the database. |
| `bun run db:studio` | Open Drizzle Studio for visual database browsing. |
| `bun run scripts/generate.ts` | Rebuild route tree from module definitions. |

---

### project structure

```
my-app/
  .env
  .env.example
  package.json            ← depends on @vobase/core
  drizzle.config.ts
  vobase.config.ts        ← database path, auth, connections, webhooks
  vite.config.ts          ← Vite + TanStack Router + path aliases
  index.html
  server.ts               ← createApp() entry + export type AppType
  AGENTS.md               ← project context and guardrails
  .agents/
    skills/
      integer-money/
        SKILL.md          ← core: all money as integer cents
  db-schemas.ts            ← core table schemas for drizzle-kit (Node.js compat)
  modules/
    system/               ← admin dashboard (scaffolded)
      index.ts            ← defineModule() — system as a user module
      schema.ts
      handlers.ts         ← health, audit log, sequences, record audits
      pages/
        layout.tsx
        list.tsx
        logs.tsx
    index.ts              ← module registry
    projects/             ← example module you add
      index.ts            ← defineModule()
      schema.ts
      handlers.ts
      jobs.ts
      pages/
  src/
    main.tsx
    home.tsx
    root.tsx
    routes.ts             ← generated route definitions
    routeTree.gen.ts      ← generated TanStack route tree
    lib/
      api-client.ts
      auth-client.ts
      utils.ts
    components/
      ui/                 ← shadcn/ui (owned by you)
    shell/
      layout.tsx
      sidebar.tsx
      auth/
        login.tsx
        signup.tsx
    styles/
      app.css
  data/
    vobase.db             ← your entire database
    vobase.db-wal
    vobase.db-shm
    files/                ← optional, created on first upload
    backups/
```

---

### license

MIT. Own everything.
