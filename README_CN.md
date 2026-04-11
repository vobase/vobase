<p align="center">
  <a href="README.md">English</a> / 中文
</p>

<p align="center">
  <b>vobase</b>
  <br>
  为 AI 编程智能体打造的应用框架。<br>
  每行代码都是你的。你的 AI 已经知道如何基于它构建。
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
  <a href="#开箱即用">开箱即用</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#模块长什么样">代码示例</a> ·
  <a href="#agent-skills">Skills</a> ·
  <a href="#与同类方案对比">对比</a> ·
  <a href="https://docs.vobase.dev">文档</a>
</p>

---

一个全栈 TypeScript 框架，在单进程中提供认证、数据库、存储和后台任务。本地开发使用 Docker Compose Postgres，生产环境使用托管 Postgres。像自托管的 Supabase —— 但每行代码都是你的。像 Pocketbase —— 但它是你能阅读和修改的 TypeScript。

AI 编程智能体（Claude Code、Cursor、Codex）天然理解 vobase。严格的约定和 Agent Skills 确保生成的代码一次就能跑通 —— 不用反复调试。

你拥有代码。你拥有数据。你拥有基础设施。

---

### 开箱即用

一条 `bun create vobase` 即可获得完整的全栈应用：

| 能力 | 说明 |
|---|---|
| **运行时** | **Bun** —— 原生 TypeScript，~50ms 启动，内置测试框架。一个进程，一个容器。 |
| **数据库** | **PostgreSQL** + **Drizzle**。本地开发 Docker Compose Postgres（pgvector/pg17），生产环境使用托管 Postgres。完整 SQL、ACID 事务、pgvector 向量检索。 |
| **认证** | **better-auth**。会话管理、密码认证、CSRF 防护。RBAC 角色守卫、API Key、可选的组织/团队支持。SSO/2FA 以插件形式扩展。 |
| **API** | **Hono** —— ~14KB，类型化路由，Bun 优先。所有 AI 编程工具都已熟知 Hono。 |
| **审计** | 内置审计日志、记录变更追踪和认证事件钩子。每个变更都可追溯。 |
| **序列号** | 无间断业务编号生成（INV-0001、PO-0042）。事务安全，绝不跳号。 |
| **存储** | 虚拟桶文件存储，支持本地或 S3 后端。元数据存储在 Postgres 中。 |
| **消息通道** | 多通道消息，可插拔适配器。WhatsApp（Cloud API）、邮件（Resend、SMTP）。入站 Webhook、出站发送、投递追踪。所有消息均有日志。 |
| **集成** | 外部服务加密凭证保险库（OAuth 提供商、API）。AES-256-GCM 静态加密。平台感知：可选的多租户 OAuth 移交（HMAC 签名 JWT）。 |
| **后台任务** | 带重试、定时和任务链的后台作业。**pg-boss** 驱动 —— 仅需 Postgres，无需 Redis。 |
| **知识库** | 上传 PDF、DOCX、XLSX、PPTX、图片、HTML。自动提取为 Markdown，分块、向量化、检索。RRF + HyDE 混合搜索。Gemini OCR 处理扫描件。 |
| **AI 智能体** | 通过 [Mastra](https://mastra.ai) 在顶层 `mastra/` 目录声明式定义智能体。多提供商（OpenAI、Anthropic、Google）。工具、工作流、记忆处理器、评估评分器。开发时内嵌 **Mastra Studio**（`/studio`）。前端使用 AI SDK `useChat`。 |
| **前端** | **React + TanStack Router + shadcn/ui + Tailwind v4**。类型安全路由 + 代码生成 + 代码分割。组件源码归你所有 —— 无需 tailwind.config.js。 |
| **Skills** | 领域知识包，教会 AI 智能体你的应用模式和约定。 |
| **MCP** | 模块感知工具，通过 API Key 认证（**@modelcontextprotocol/sdk**）。AI 工具可以在写代码之前查看你的 Schema、模块列表和日志。同进程，共享端口。 |
| **部署** | 内含 Dockerfile + railway.toml。一条 `railway up` 或 `docker build` 即可上线。 |

在本地，`docker compose up -d` 启动 pgvector/pg17 Postgres 实例。`bun run dev` 即可开始构建。生产环境只需将 `DATABASE_URL` 指向任意托管 Postgres 实例。

---

### 快速开始

```bash
bun create vobase my-app
cd my-app
bun run dev
```

先用 `docker compose up -d` 启动 Postgres，后端运行在 `:3000`，前端运行在 `:5173`。开箱即带仪表盘和审计日志查看器。

---

### 你能用它构建什么

每个模块都是一个自包含目录：Schema、处理函数、后台任务、页面。没有插件系统，没有市场。只有你拥有的 TypeScript 代码。

| 场景 | 开箱内容 |
|---|---|
| **SaaS 起步** | 用户账户、计费集成、订阅管理、管理后台。认证 + 后台任务 + Webhook 处理基础设施。 |
| **内部工具** | 管理面板、运营仪表盘、审批工作流。状态机保障业务逻辑。审计追踪记录每次变更。 |
| **CRM 与联系人** | 公司、联系人、互动时间线、商机追踪。跨模块引用保持解耦。 |
| **项目管理** | 任务、分配、状态工作流、通知。后台任务处理提醒和升级。 |
| **账单与发票** | 发票、行项、收付款、账龄报表。整数金额确保精确计算。事务内无间断编号。 |
| **你的垂直领域** | 物业管理、车队追踪、现场服务 —— 业务需要什么就做什么。向 AI 工具描述需求，它就能生成模块。 |

模块启动器以 Skills 形式提供：`vobase add skill <name>`。像 `npx shadcn add button` 一样 —— 文件复制到你的项目，代码归你所有。

---

### 工作原理

Vobase 让自身对市面上所有 AI 编程工具都「可读」。

框架内置严格约定和 **Agent Skills** —— 教会 AI 工具你的应用如何运作的领域知识包。当你需要新功能时：

1. 打开你的 AI 工具，描述需求
2. AI 读取现有 Schema、模块约定和相关 Skills
3. 生成完整模块 —— Schema、处理函数、后台任务、页面、测试、种子数据
4. 你审查 diff，运行 `bun run dev`，一切正常运行

Skills 覆盖应用中容易踩坑的部分：金额存储为整数分（而非浮点数），状态转换是显式状态机（而非任意字符串更新），业务编号在数据库事务内生成（而非会跳号的自增 ID）。

这些约定正是 AI 生成的模块能一次跑通的关键。

**核心理念：** 你的业务规范和领域知识是资产。AI 工具是编译器。编译器每个季度都在进步。你的 Skills 永久积累。

---

### 模块长什么样

每个模块通过 `defineModule()` 声明。这个约定是 AI 工具生成正确代码的依据。

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
    // 可选：启动时执行初始化逻辑，可访问 db、scheduler、http、storage、channels、realtime
  },
})
```

```
modules/projects/
  schema.ts           ← Drizzle 表定义
  handlers.ts         ← Hono 路由（HTTP API）
  handlers.test.ts    ← 就近放置的测试（bun test）
  jobs.ts             ← 后台任务（pg-boss，无需 Redis）
  pages/              ← React 页面（列表、详情、创建）
  seed.ts             ← 开发用示例数据
  index.ts            ← defineModule()
```

<details>
<summary><b>Schema 示例</b> —— Drizzle + PostgreSQL，类型化列、时间戳、状态枚举</summary>

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
<summary><b>Handler 示例</b> —— Hono 路由，类型化上下文与授权</summary>

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

前端通过代码生成获得完整类型化的 API 调用：

```typescript
import { hc } from 'hono/client'
import type { AppType } from './api-types.generated'

const client = hc<AppType>('/')
const res = await client.api.projects.$get()
const projects = await res.json()  // 完整类型 —— 每个路由和响应都有自动补全
```

`AppType` 由服务端路由树代码生成，从 Handler 返回值到前端消费实现端到端类型安全。

</details>

<details>
<summary><b>Job 示例</b> —— 通过 pg-boss 的后台任务，无需 Redis</summary>

```typescript
// modules/projects/jobs.ts
import { defineJob } from '@vobase/core'
import { tasks } from './schema'
import { eq } from 'drizzle-orm'

export const sendReminder = defineJob('projects:sendReminder',
  async (data: { taskId: string }) => {
    const task = await db.select().from(tasks)
      .where(eq(tasks.id, data.taskId))
    // 发送通知、更新状态、记录操作
  }
)
```

在 Handler 中调度：`ctx.scheduler.add('projects:sendReminder', { taskId }, { delay: '1d' })`

重试、定时调度和优先级队列 —— 全部通过 pg-boss 基于 Postgres 实现。

</details>

---

### ctx 对象

每个 HTTP Handler 都可获取一个包含运行时能力的上下文对象。当前 API 如下：

| 属性 | 说明 |
|---|---|
| `ctx.db` | Drizzle 实例。完整 PostgreSQL —— 读写、事务。 |
| `ctx.user` | `{ id, email, name, role, activeOrganizationId? }`。来自 better-auth 会话，用于授权检查。RBAC 中间件：`requireRole()`、`requirePermission()`、`requireOrg()`。 |
| `ctx.scheduler` | 任务队列。`add(jobName, data, options)` 调度后台作业。 |
| `ctx.storage` | `StorageService` —— 虚拟桶，本地/S3 后端。`ctx.storage.bucket('avatars').upload(key, data)`。 |
| `ctx.channels` | `ChannelsService` —— 邮件和 WhatsApp 发送。`ctx.channels.email.send(msg)`。所有消息均有日志。 |
| `ctx.integrations` | `IntegrationsService` —— 加密凭证保险库。`ctx.integrations.getActive(provider)` 返回解密后的配置或 null。平台管理的提供商通过 HMAC 签名转发连接。 |
| `ctx.http` | 类型化 HTTP 客户端，带重试、超时和熔断器。 |
| `ctx.realtime` | `RealtimeService` —— 基于 PostgreSQL LISTEN/NOTIFY + SSE 的事件驱动服务端推送。变更后调用 `ctx.realtime.notify({ table, id?, action? }, tx?)`。 |

Job 的依赖通过闭包/工厂函数传入（或在 `defineJob(...)` 中直接导入所需模块）。

#### 模块初始化上下文

模块可声明 `init` 钩子，在启动时接收 `ModuleInitContext` —— 与请求上下文相同的服务（`db`、`scheduler`、`http`、`storage`、`channels`、`realtime`）。未配置的服务使用 throw-proxy，访问时会给出描述性错误。

#### ctx 外部集成扩展

除本地能力（数据库、用户、调度器、存储）外，`ctx` 还提供出站连接和入站事件处理：

| 属性 | 说明 |
|---|---|
| `ctx.http` | 类型化 fetch 封装，带重试、超时、熔断器和结构化错误响应。通过 `vobase.config.ts` 中的 `http` 按应用配置。 |
| `webhooks`（应用级） | 入站 Webhook 接收器，带 HMAC 签名验证、去重和自动入队到 Job。在 `vobase.config.ts` 中配置，挂载为 `/webhooks/*` 路由 —— 不是 ctx 属性。 |

```typescript
// vobase.config.ts
export default defineConfig({
  database: process.env.DATABASE_URL,
  integrations: { enabled: true },      // 可选：加密凭证存储、提供商配置
  storage: {                            // 可选：文件存储
    provider: { type: 'local', basePath: './data/files' },
    buckets: { avatars: { maxSize: 5_000_000 }, documents: {} },
  },
  channels: {                           // 可选：邮件 + WhatsApp
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

凭证存放在 `.env` 中。配置只声明结构。

---

### 与同类方案对比

| | **Vobase** | **Supabase** | **Pocketbase** | **Rails / Laravel** |
|---|---|---|---|---|
| 你得到什么 | 全栈脚手架（后端 + 前端 + Skills） | 后端即服务（数据库 + 认证 + 存储 + 函数） | 后端二进制（数据库 + 认证 + 存储 + API） | 全栈框架 |
| 语言 | 端到端 TypeScript | TypeScript（客户端）+ PostgreSQL | Go（闭源二进制） | Ruby / PHP |
| 数据库 | PostgreSQL（本地 Docker Compose，生产托管） | PostgreSQL（托管） | SQLite（嵌入式） | PostgreSQL / MySQL |
| 自托管 | 单进程，单容器 | [10+ Docker 容器](https://supabase.com/docs/guides/self-hosting/docker) | 单二进制 | 多进程 |
| 代码归属 | 是 —— 所有源码在你的项目中 | 否 —— 托管服务 | 否 —— 编译后的二进制 | 是 —— 但没有 AI 约定 |
| AI 集成 | Agent Skills + MCP + 严格约定 | 无 | 无 | 无 |
| 自定义方式 | 直接改代码。AI 能读懂。 | 控制台 + RLS 策略 | 管理 UI + 钩子 | 直接改代码 |
| 托管成本 | 低至 $15/月 | $25/月起（或复杂自托管） | 免费（自托管） | 视情况而定 |
| 数据隔离 | 物理隔离（每个应用一个数据库） | 逻辑隔离（RLS） | 物理隔离 | 视情况而定 |
| 许可证 | MIT | Apache 2.0 | MIT | MIT |

**vs Supabase：** 自托管 Supabase 需要 [10+ Docker 容器](https://supabase.com/docs/guides/self-hosting/docker)。RLS 策略难以推理。你不拥有后端代码。Vobase 是单进程，你拥有每行代码 —— AI 智能体可以读取和修改一切。

**vs Pocketbase：** Pocketbase 是 Go 二进制。你能看到管理 UI，但无法阅读或修改内部实现。当需要自定义业务逻辑时，你得写 Go 插件或调用外部服务。Vobase 是你拥有的 TypeScript —— AI 智能体原生理解并扩展它。

**vs Rails / Laravel：** 优秀的框架，但它们不是为 AI 编程智能体设计的。Vobase 的严格约定和 Agent Skills 确保 AI 生成的代码始终遵循你的模式。此外：更简洁的技术栈（无 Redis，单进程，端到端 TypeScript）。

---

### 运行时架构

一个 Bun 进程。一个 Docker 容器。一个应用。

```
Docker 容器 (--restart=always)
  └── Bun 进程 (PID 1)
        ├── Hono 服务器
        │     ├── /auth/*       → better-auth（会话、密码、CSRF）
        │     ├── /api/*        → 模块 Handler（会话验证）
        │     ├── /api/mastra/* → Mastra 智能体/工具/工作流 API
        │     ├── /studio       → Mastra Studio SPA（仅开发环境）
        │     ├── /mcp          → MCP 服务器（同进程，共享端口）
        │     ├── /webhooks/*   → 入站事件接收器（签名验证、去重）
        │     └── /*            → 前端（静态文件，来自 dist/）
        ├── Drizzle（bun:sql → PostgreSQL）
        ├── 内置模块
        │     ├── _auth         → better-auth + AuthAdapter 契约
        │     ├── _audit        → 审计日志、记录追踪、认证钩子
        │     ├── _sequences    → 无间断业务编号计数器
        │     ├── _integrations → 加密凭证保险库、平台 OAuth 移交（可选）
        │     ├── _storage      → 虚拟桶，本地/S3（可选）
        │     └── _channels     → 统一消息，适配器模式（可选）
        ├── pg-boss（Postgres 驱动的任务队列）
        ├── 出站 HTTP（类型化 fetch、重试、熔断器）
        └── 审计中间件（所有变更 → _audit_log）
```

---

### MCP 服务器

运行在同一个 Bun 进程中，使用同一端口。通过 API Key 认证（better-auth apiKey 插件）。当你连接 Claude Code、Codex、Cursor 或任何 MCP 兼容工具时，它能看到你的应用：

| 工具 | 说明 |
|---|---|
| `list_modules` | 列出所有已注册模块（内置 + 用户自定义） |
| `read_module` | 读取指定模块 Schema 中的表名 |
| `get_schema` | 列出所有模块的全部表名 |
| `view_logs` | 返回最近的审计日志条目 |

AI 在写第一行代码之前就能看到你的数据模型、现有模块和约定。

---

### 部署

构建 Docker 镜像。Railway、Fly.io 或任何 Docker 主机。设置 `DATABASE_URL` 指向托管 Postgres。

**Railway（最快）：**

```bash
railway up
```

模板预配置了 `Dockerfile` 和 `railway.toml`。添加 Postgres 插件后，Railway 自动设置 `DATABASE_URL`。

**Docker Compose：**

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

### 项目命令

脚手架生成后，你的项目直接使用标准工具 —— 无需额外 CLI：

| 命令 | 说明 |
|---|---|
| `docker compose up -d` | 启动本地 Postgres（pgvector/pg17，端口 5432）。 |
| `bun run dev` | 以 `--watch` 启动 Bun 后端和 Vite 前端。修改后自动重启。 |
| `bun run db:push` | 应用 fixtures 后推送 Schema 到数据库（开发环境）。 |
| `bun run db:generate` | 为生产环境生成迁移文件。 |
| `bun run db:migrate` | 对数据库执行迁移。 |
| `bun run db:seed` | 填充默认管理员用户和示例数据。 |
| `bun run db:reset` | 删除并重建数据库，推送 Schema，填充种子数据。 |
| `bun run db:studio` | 打开 Drizzle Studio 可视化浏览数据库。 |

---

### 项目结构

```
my-app/
  .env
  .env.example
  package.json            ← 依赖 @vobase/core
  docker-compose.yml      ← 本地 Postgres（pgvector/pg17）
  drizzle.config.ts
  vobase.config.ts        ← 数据库 URL、认证、连接、Webhook
  vite.config.ts          ← Vite + TanStack Router + 路径别名
  index.html
  server.ts               ← createApp() 入口 + Mastra 初始化 + Studio 挂载
  AGENTS.md               ← 项目上下文和约束
  .agents/
    skills/
      integer-money/
        SKILL.md          ← 核心：所有金额为整数分
  mastra/                 ← Mastra 原语（遵循 Mastra 项目约定）
    index.ts              ← Mastra 单例：initMastra()、getMastra()、getMemory()
    studio.ts             ← 仅开发环境的 Studio SPA 中间件
    agents/               ← 智能体定义（Mastra Agent 实例）
    tools/                ← RAG 工具、升级处理等
    workflows/            ← 人机协作流程
    processors/           ← 输入/输出处理器 + EverMemOS 记忆管道
    evals/                ← 评估框架（评分器、运行器）
    mcp/                  ← AI 模块 MCP 服务器
    lib/                  ← 依赖注入、模型别名、可观测性
  modules/
    ai/                   ← AI 对话、智能体、记忆、评估、通道
      index.ts            ← defineModule() —— 从 ../../mastra/ 导入
      schema.ts           ← 对话、mem_cells、episodes、facts 等
      handlers/           ← 聊天、对话、通道、联系人、评估、记忆等
      jobs.ts             ← 记忆形成、评估运行、发件箱投递
      lib/                ← 状态机、聊天桥接、通道回复、发件箱
      pages/              ← 对话、联系人、通道、AI 配置、评估
    system/               ← 运维仪表盘
      index.ts            ← defineModule()
      handlers.ts         ← 健康检查、审计日志、序列号、记录审计
      pages/
    knowledge-base/       ← 文档摄入 + 混合搜索
      index.ts
      schema.ts
      handlers.ts
      jobs.ts             ← 队列异步文档处理
      lib/                ← 提取、分块、嵌入、搜索管道
      pages/
    integrations/         ← 外部服务凭证管理
      index.ts
      handlers.ts
      jobs.ts
    index.ts              ← 模块注册表
    your-module/          ← 你添加的模块
      index.ts            ← defineModule()
      schema.ts
      handlers.ts
      jobs.ts
      pages/
  src/
    main.tsx
    home.tsx
    root.tsx
    routeTree.gen.ts      ← 生成的 TanStack 路由树
    lib/
    components/
      ui/                 ← shadcn/ui（归你所有）
      ai-elements/        ← AI 聊天 UI 组件（归你所有）
      chat/               ← 聊天专用组件
      data-table/         ← DiceUI 数据表格组件
    shell/
      app-layout.tsx      ← 主应用外壳（带侧边栏）
      shell-header.tsx
      command-palette.tsx
      auth/               ← 登录、注册
      settings/           ← 用户、组织、API Key、集成设置
    hooks/
    styles/
    stores/
    types/
  data/
    files/                ← 可选，首次上传时创建
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
觉得有帮助就点个 Star 吧
</p>

---

### 许可证

MIT。一切归你所有。
