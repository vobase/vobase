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
  <a href="#智能体运行时">运行时</a> ·
  <a href="#与同类方案对比">对比</a> ·
  <a href="https://docs.vobase.dev">文档</a>
</p>

---

一个全栈 TypeScript 框架，在单个 Bun 进程中提供认证、数据库、存储、后台任务，以及一流的 AI 智能体运行时。本地开发使用 Docker Compose Postgres，生产环境使用托管 Postgres。像自托管的 Supabase —— 但每行代码都是你的。像 Pocketbase —— 但它是你能阅读和修改的 TypeScript。

AI 编程智能体（Claude Code、Cursor、Codex）天然理解 vobase。严格的约定和统一的模块形态确保生成的代码一次就能跑通 —— 不用反复调试。

你拥有代码。你拥有数据。你拥有基础设施。

---

### 开箱即用

一条 `bun create vobase` 即可获得完整的全栈应用：

| 能力 | 说明 |
|---|---|
| **运行时** | **Bun** —— 原生 TypeScript，~50ms 启动，内置测试框架。一个进程，一个容器。 |
| **数据库** | **PostgreSQL** + **Drizzle**。本地开发 Docker Compose Postgres（pgvector/pg17），生产环境使用托管 Postgres。完整 SQL、ACID 事务、pgvector 向量检索。 |
| **认证** | **better-auth**。会话、密码、邮箱 OTP、CSRF。RBAC 角色守卫、API Key、组织。SSO/2FA 以插件形式扩展。 |
| **API** | **Hono** —— ~14KB，类型化路由，Bun 优先。所有 AI 编程工具都已熟知 Hono。 |
| **审计** | 内置审计日志、记录变更追踪和认证事件钩子。每个变更都可追溯。 |
| **序列号** | 无间断业务编号生成（INV-0001、PO-0042）。事务安全，绝不跳号。 |
| **存储** | 虚拟桶文件存储，支持本地或 S3/R2 后端。元数据存储在 Postgres 中。 |
| **消息通道** | 多通道消息，可插拔适配器：WhatsApp（Cloud API）、邮件（Resend、SMTP）。入站 Webhook、出站发送、投递追踪。所有消息均有日志。 |
| **集成** | 外部服务加密凭证保险库。AES-256-GCM 静态加密。平台感知：可选的多租户 OAuth 移交（HMAC 签名 JWT）。 |
| **后台任务** | 带重试、定时和任务链的后台作业。**pg-boss** 驱动 —— 仅需 Postgres，无需 Redis。 |
| **实时推送** | 通过 PostgreSQL `LISTEN/NOTIFY` + SSE 推送。无 WebSocket。模块在事务提交后 `pg_notify`，前端 hook 使匹配的 TanStack Query 缓存失效。 |
| **智能体运行时** | 一流的 AI 智能体 harness（`pi-agent-core` + `pi-ai`）。每次唤醒锁定系统提示词、字节稳定的 provider 缓存、工具输出溢写、轮次间的 steer/abort、journal 化事件、空闲恢复、重启恢复。 |
| **工作区** | 每次唤醒由模块物化的虚拟文件系统。AGENTS.md 由各模块片段拼装；智能体读取 `/staff/<id>/profile.md`、`/contacts/<id>/MEMORY.md` 等。FS 边界强制只读。 |
| **CLI** | **`@vobase/cli`** —— 独立的目录驱动二进制。模块通过 `defineCliVerb` 注册命令；同一份 body 既在进程内运行（智能体 bash 沙箱），也通过 HTTP-RPC 运行（`vobase` 二进制）。 |
| **前端** | **React + TanStack Router + shadcn/ui + ai-elements + DiceUI + Tailwind v4**。类型安全路由 + 代码生成 + 代码分割。组件源码归你所有。 |
| **MCP** | 在同一进程中运行的 Model Context Protocol 服务器。AI 工具在写代码之前可以查看 Schema、模块和日志。 |
| **部署** | 内含 Dockerfile + railway.json。一条 `railway up` 或 `docker build` 即可上线。 |

在本地，`docker compose up -d` 启动 pgvector/pg17 Postgres 实例。`bun run dev` 即可开始构建。生产环境只需将 `DATABASE_URL` 指向任意托管 Postgres。

---

### 快速开始

```bash
bun create vobase my-app
cd my-app
docker compose up -d
bun run db:reset
bun run dev
```

后端运行在 `:3001`，前端运行在 `:5173`。开箱即带智能体原生 helpdesk 模板 —— 消息、通道、联系人、团队、drive、智能体 —— 全部已接好。

---

### 你能用它构建什么

每个模块都是一个自包含目录：schema、service、handlers、jobs、pages，以及一个 `agent.ts` 槽，向 harness 发布工具、materializer、只读提示和 AGENTS.md 片段。没有插件系统，没有市场。只有你拥有的 TypeScript 代码。

| 场景 | 开箱内容 |
|---|---|
| **智能体原生 Helpdesk** | 默认模板。WhatsApp + 邮件收件箱、联系人记忆、@员工 fan-out、主管教导、定时跟进、审批门、drive 叠加层。 |
| **SaaS 起手式** | 用户账户、计费集成、订阅管理。认证 + 后台任务 + Webhook 处理底层管道。 |
| **内部工具** | 管理面板、运营仪表盘、审批流程。状态机强制业务逻辑。审计追踪每次变更。 |
| **CRM 客户管理** | 公司、联系人、互动时间线、商机追踪。跨模块引用通过 service 导入 —— 不跨模块外键。 |
| **项目追踪** | 任务、分配、状态流、通知。后台任务处理提醒和升级。 |
| **账单与发票** | 发票、行项目、付款、账龄报表。整数金额确保精确运算。事务内生成无间断编号。 |
| **你的垂直领域** | 物业管理、车队追踪、现场服务 —— 业务需要什么都行。把它描述给 AI 工具，它会生成模块。 |

AI 编程智能体根据你的约定生成模块。就像 `npx shadcn add button` —— 文件被复制过来，代码归你所有。

---

### 工作原理

Vobase 让自己被市面上每一种 AI 编程工具读懂。

框架带着一个规范化的模块形态、一个写路径纪律，以及一个 AI 智能体在运行时驱动的 harness。当你需要新能力时：

1. 打开你的 AI 工具，描述需求
2. AI 读取你已有的 schema、规范化模块形态以及相关的 `.claude/skills/` 包
3. 它生成一个完整模块 —— schema、service、handlers、jobs、pages、agent slot、tests、seed data
4. 你审查 diff，运行 `bun run dev`，它就能跑

Skill 包覆盖了应用中最棘手的部分：金额以整数分存储（绝不用浮点）、状态转换显式状态机（不用任意字符串更新）、数据库事务内生成无间断业务编号、`check:shape` 强制单写路径、`check:bundle` 隔离前端 bundle。

这些约定就是 AI 生成的模块一次就能跑通的原因。

**核心论点：** 你的规范和领域知识才是资产。AI 工具是编译器。编译器每季度都在升级。你的 skills 永远复利。

---

### 模块长什么样

每个模块都是兄弟文件之上的薄聚合器。`module.ts` 声明契约，其他都放在拥有副作用的代码旁边。

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
  module.ts            ← 薄聚合器（如上）
  schema.ts            ← Drizzle 表定义
  state.ts             ← 状态转换、状态机
  service/             ← 事务化写路径（本模块表的唯一写者）
  handlers/            ← Hono 路由（HTTP API）
  web.ts               ← 挂载在 /api/projects 下的路由 barrel
  pages/               ← React 页面 —— 列表、详情、新建
  components/          ← 本模块拥有的 React 组件
  hooks/               ← TanStack Query hooks
  jobs.ts              ← pg-boss 处理器
  agent.ts             ← 智能体槽：tools、materializers、roHints、AGENTS.md 片段
  tools/               ← defineAgentTool —— 与 service 同栖
  verbs/               ← defineCliVerb —— 在智能体 bash 与 CLI 二进制中运行
  cli.ts               ← 导出 <module>Verbs 的 barrel
  seed.ts              ← 演示数据
  defaults/            ← *.agent.yaml、*.schedule.yaml —— 可选的初始内容
  skills/              ← 智能体通过 drive 叠加层读取的 skill 内容
  *.test.ts            ← 同栖的 bun test
```

<details>
<summary><b>schema 示例</b> —— Drizzle + PostgreSQL，类型化列、时间戳、状态枚举</summary>

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

`check:shape` 强制：只有 `service/projects.ts` 能写 `projects` —— handlers 和 jobs 都走 service。

</details>

<details>
<summary><b>handler 示例</b> —— Hono 路由 + Zod 校验 + 类型化 RPC 客户端</summary>

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

前端通过 Hono RPC 客户端（`src/lib/api-client.ts`）获得完整类型化的 API 调用：

```typescript
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const res = await api.projects.$get({ query: {} })
      return await res.json() // 完整类型
    },
  })
}
```

`use-realtime-invalidation.ts` 把 `pg_notify` 的 `table` payload 映射到 TanStack `queryKey` 的第一个元素 —— service 在事务提交后发出 notify，UI 自动重新拉取。

</details>

<details>
<summary><b>job 示例</b> —— pg-boss 驱动的后台任务，无需 Redis</summary>

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

从 handler 或 service 调度：`ctx.scheduler.add('projects:send-reminder', { taskId }, { delay: '1d' })`。重试、cron 调度、优先级队列 —— 全部由 pg-boss 基于 Postgres 提供。

</details>

<details>
<summary><b>智能体槽示例</b> —— tools、materializers、AGENTS.md 片段</summary>

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
    render: () => '## Projects\n\n- `create_task` 给项目添加任务。',
  })],
  materializers: [/* WorkspaceMaterializerFactory<WakeContext>[] */],
  roHints: [/* 解释 /projects/<id>/* 路径为何只读 */],
  tools: [createTask],
}
```

唤醒构建器按 `lane` 和 `audience` 过滤工具，对每个 materializer 工厂传入 wake context，链式合成 roHints，并将 AGENTS.md 贡献者喂给 harness。每个模块一个 agent 槽 —— 没有需要更新的中央注册表。

</details>

---

### ctx 对象

每个 HTTP handler 都会得到一个携带运行时能力的上下文对象。当前 surface：

| 属性 | 说明 |
|---|---|
| `ctx.db` | Drizzle 实例。完整 PostgreSQL —— 读、写、事务。 |
| `ctx.user` | `{ id, email, name, role, activeOrganizationId? }`。来自 better-auth 会话。RBAC 中间件：`requireRole()`、`requirePermission()`、`requireOrg()`。 |
| `ctx.scheduler` | 任务队列。`add(jobName, data, options)` 调度后台任务。 |
| `ctx.storage` | `StorageService` —— 本地/S3/R2 后端的虚拟桶。 |
| `ctx.channels` | `ChannelsService` —— 邮件和 WhatsApp 发送。所有消息有日志。 |
| `ctx.integrations` | 加密凭证保险库。`ctx.integrations.getActive(provider)` 返回解密配置或 null。 |
| `ctx.http` | 类型化 HTTP 客户端，带重试、超时、断路器。 |
| `ctx.realtime` | `RealtimeService` —— 在 mutation 后调用 `notify({ table, id?, action? }, tx?)`。SSE 订阅者收到事件，前端 hook 使匹配的 TanStack 查询失效。 |

模块可以声明 `init(ctx: ModuleInitCtx)` 钩子，在启动时拿到 `{ db, realtime, jobs, scheduler, auth, cli }`。跨模块调用直接 `import` 自 `@modules/<name>/service/*` —— 无 port shim、无插件系统。未配置的服务使用 throw-proxy，访问时给出描述性错误。

应用级配置：

```typescript
// vobase.config.ts
export default defineConfig({
  database: process.env.DATABASE_URL,
  integrations: { enabled: true },      // 可选：加密凭证存储
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

凭证留在 `.env`。配置只声明形态。

---

### 智能体运行时

harness 是 core 中的 AI 运行时。它构建于 `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai` 之上，以 `@vobase/core` 的 `createHarness({...})` 形式发布。每次「唤醒」是智能体在一个锁定的系统提示词上进行的一次有界运行。

**Lane（车道）** —— 模板自带两条：

- **Conversation（会话）** —— 绑定 `(contactId, channelInstanceId, conversationId)`。由 `inbound_message`、`supervisor`、`approval_resumed`、`scheduled_followup`、`manual` 触发。
- **Standalone（独立）** —— 操作员线程 + 心跳。由 `operator_thread`、`heartbeat` 触发。面向客户的工具会被过滤掉。

**Core 内嵌的不变量：**

- *锁定快照。* 系统提示词在 `agent_start` 时算一次；`systemHash` 每轮相同，让 provider 的前缀缓存保持温热。唤醒中途的写入会出现在下一轮的 side-load 中。
- *轮次间 Steer/Abort。* 客户消息进入 steer 队列，在 `tool_execution_end` 之后排空。Supervisor 和 approval-resumed 事件硬中止并重新唤醒。
- *工具 stdout 预算。* 4KB 内联 → 100KB 溢写（`/tmp/tool-<callId>.txt`）→ 200KB 轮次上限。
- *空闲恢复 + 重启恢复。* harness 在启动时恢复孤立的 dispatch，并通过 journal 化事件恢复空闲唤醒。
- *成本上限。* 日花费追踪 + 每组织求值门。

**工作区** —— 每次唤醒都跑在由模块物化出的虚拟文件系统上。AGENTS.md 由每个模块的 `agentsMd` 贡献者（加上每个工具的指南）拼装。只读路径在 FS 边界由 `ScopedFs` 强制。记忆写入（`/contacts/<id>/MEMORY.md`、`/agents/<id>/MEMORY.md`、`/staff/<id>/MEMORY.md`）在轮次结束时落盘。

**LLM provider** —— 单一接缝。`BIFROST_API_KEY` + `BIFROST_URL` 同时设置时走 Bifrost，否则直接打 OpenAI / Anthropic / Google。在模板中使用 `~/wake` 的 `createModel(alias)`；切勿硬编码带 provider 前缀的 id。

**测试** —— 把 `streamFn: stubStreamFn([...])`（每次 LLM 调用一组内联 `AssistantMessageEvent[]`）传给 `bootWake`，让测试不接触真实 provider。`tests/smoke/` 下的 live 测试用真实 key 跑。

---

### 与同类方案对比

| | **Vobase** | **Supabase** | **Pocketbase** | **Rails / Laravel** |
|---|---|---|---|---|
| 你得到什么 | 全栈脚手架（后端 + 前端 + 智能体 harness + skills） | 后端即服务（数据库 + 认证 + 存储 + 函数） | 后端二进制（数据库 + 认证 + 存储 + API） | 全栈框架 |
| 语言 | 端到端 TypeScript | TypeScript（客户端）+ PostgreSQL | Go（闭源二进制） | Ruby / PHP |
| 数据库 | PostgreSQL（本地 Docker Compose、生产托管） | PostgreSQL（托管） | SQLite（嵌入） | PostgreSQL / MySQL |
| 自托管 | 一个进程，一个容器 | [10+ 个 Docker 容器](https://supabase.com/docs/guides/self-hosting/docker) | 一个二进制 | 多进程 |
| 你拥有代码 | 是 —— 所有源码都在你的项目中 | 否 —— 托管服务 | 否 —— 编译后二进制 | 是 —— 但没有 AI 约定 |
| AI 智能体运行时 | 一流 harness（锁定提示、工具预算、steer/abort） | 仅 edge functions | 无 | 无 |
| AI 集成 | Skills + MCP + 规范化模块形态 | 无 | 无 | 无 |
| 如何定制 | 改代码。AI 读得懂。 | 仪表盘 + RLS 策略 | 管理 UI + 钩子 | 改代码 |
| 托管成本 | 最低 $15/月 | $25/月起（或复杂自托管） | 免费（自托管） | 视情况 |
| 数据隔离 | 物理（每个应用一个数据库） | 逻辑（RLS） | 物理 | 视情况 |
| 许可证 | MIT | Apache 2.0 | MIT | MIT |

**vs Supabase：** 自托管 Supabase 是 [10+ 个 Docker 容器](https://supabase.com/docs/guides/self-hosting/docker)。RLS 策略难以推理。你不拥有后端代码。Vobase 是单进程，每行代码都是你的 —— AI 智能体能读能改一切。

**vs Pocketbase：** Pocketbase 是 Go 二进制。你能看到管理 UI，但读不到也改不了内部实现。需要自定义业务逻辑时，要么写 Go 插件，要么调外部服务。Vobase 是你拥有的 TypeScript —— AI 智能体原生理解和扩展。

**vs Rails / Laravel：** 优秀的框架，但它们不是为 AI 编程智能体设计的。Vobase 的规范化模块形态和 skill 包让 AI 生成的代码始终遵循你的模式。此外：栈更简单（无 Redis、单进程、端到端 TypeScript）。

---

### 运行时架构

一个 Bun 进程。一个 Docker 容器。一个应用。

```
Docker 容器（--restart=always）
  └── Bun 进程（PID 1）
        ├── Hono 服务器
        │     ├── /api/auth/*    → better-auth（会话、OTP、CSRF）
        │     ├── /api/<mod>/*   → 模块 web 路由（会话校验）
        │     ├── /api/cli/*     → CLI 目录 + 派发（HTTP-RPC）
        │     ├── /mcp           → MCP 服务器（同进程，共享端口）
        │     ├── /webhooks/*    → 入站通道 webhook（验签、去重）
        │     ├── /api/realtime  → SSE 流（LISTEN/NOTIFY → 客户端）
        │     └── /*             → 前端（dist/ 静态资源）
        ├── Drizzle（postgres-js → PostgreSQL）
        ├── 内置模块（在 @vobase/core 中）
        │     ├── _auth          → AuthAdapter 契约背后的 better-auth
        │     ├── _audit         → 审计日志、记录追踪、认证钩子
        │     ├── _sequences     → 无间断业务编号
        │     ├── _integrations  → 加密凭证保险库、平台 OAuth 移交（可选）
        │     ├── _storage       → 虚拟桶、本地/S3/R2（可选）
        │     └── _channels      → 统一消息、适配器模式（可选）
        ├── 模板模块（在 @vobase/template 中）
        │     ├── settings → contacts → team → drive → messaging
        │     ├── agents → schedules → channels → changes → system
        │     └── wake/  → 智能体 harness 接缝（conversation + standalone）
        ├── pg-boss（Postgres 后端的任务队列，pg-boss 自有 schema）
        ├── 出站 HTTP（类型化 fetch、重试、断路器）
        └── 审计中间件（所有 mutation → audit_log）
```

---

### MCP 服务器

在同一个 Bun 进程同一端口运行。通过 API Key（better-auth apiKey 插件）认证。当你接入 Claude Code、Codex、Cursor 或任何兼容 MCP 的工具时，它就能看到你的应用：

| 工具 | 说明 |
|---|---|
| `list_modules` | 列出所有已注册模块（内置 + 用户） |
| `read_module` | 读取某个模块 schema 中的表名 |
| `get_schema` | 列出所有模块的所有表名 |
| `view_logs` | 返回最近的审计日志条目 |

AI 在写下任何一行代码之前，就能看到你确切的数据模型、已有的模块和约定。

---

### 部署

构建 Docker 镜像。Railway、Fly.io 或任意 Docker 主机都行。设置 `DATABASE_URL` 接到托管 Postgres。

**Railway（最快）：**

```bash
railway up
```

模板自带预配置的 `Dockerfile` 和 `railway.json`。加一个 Postgres 插件，Railway 会自动设置 `DATABASE_URL`。

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

### 项目命令

脚手架完成后，你的项目直接使用标准工具 —— 没有 wrapper CLI：

| 命令 | 说明 |
|---|---|
| `docker compose up -d` | 启动本地 Postgres（pgvector/pg17，5432 端口） |
| `bun run dev` | Bun 后端 `--hot` + Vite 前端，由 `concurrently` 并行驱动 |
| `bun run db:push` | 推送 schema 到数据库（开发） |
| `bun run db:generate` | 生成生产用迁移文件 |
| `bun run db:migrate` | 对数据库执行迁移 |
| `bun run db:seed` | 写入默认管理员和示例数据 |
| `bun run db:reset` | nuke + push + seed 一次性重置 |
| `bun run db:studio` | 打开 Drizzle Studio 浏览数据库 |
| `bun run check` | 跑所有 `check:*`（`shape`、`bundle`、`no-auto-nav-tabs`、`shadcn-overrides`） |
| `bun run test` | 完整测试套件。`test:e2e` / `test:smoke` 跑实战集成 |

---

### 项目结构

```
my-app/
  .env
  .env.example
  package.json            ← 依赖 @vobase/core
  docker-compose.yml      ← 本地 Postgres（pgvector/pg17）
  drizzle.config.ts
  vite.config.ts
  index.html
  main.ts                 ← ~10 行的 Bun.serve 入口
  CLAUDE.md               ← 项目上下文与护栏
  AGENTS.md               ← 智能体护栏（镜像 CLAUDE.md）
  .claude/
    skills/               ← AI 在生成代码时读取的 skill 包
  auth/                   ← better-auth + 插件
  runtime/
    index.ts              ← 跨模块原语，ModuleDef/ModuleInitCtx
    bootstrap.ts          ← createApp()、worker 注册
    modules.ts            ← 模块静态列表
  wake/                   ← 智能体 harness 接缝（顶层）
    conversation.ts       ← 会话 lane 构建器
    standalone.ts         ← 独立 lane 构建器
    inbound.ts            ← channels:inbound-to-wake 处理器
    supervisor.ts         ← messaging:supervisor-to-wake 处理器
    operator-thread.ts    ← agents:operator-thread-to-wake 处理器
    heartbeat.ts          ← schedules cron-tick 回调
    llm.ts                ← Bifrost / 直连 provider 接缝
    trigger.ts            ← WakeTriggerKind 注册表
    workspace/            ← 每次唤醒的虚拟 FS materializer
    observers/            ← workspace-sync、journal 等
  modules/
    settings/             ← 通知偏好、每用户 UI 状态
    contacts/             ← 客户记录 + /contacts/<id>/MEMORY.md
    team/                 ← 员工目录 + 属性
    drive/                ← 虚拟文件系统；模块注册叠加层
    messaging/            ← 会话、消息、内部备注、supervisor fan-out
    agents/               ← 定义、习得 skill、员工记忆、评分
    schedules/            ← agent_schedules + cron 心跳
    channels/             ← adapters/{web,whatsapp,...} 的伞模块
    changes/              ← 通用 propose/decide/apply/history
    system/               ← 运营仪表盘、开发助手
    <每个模块>/
      module.ts           ← 薄聚合器
      schema.ts
      state.ts
      service/            ← 本模块表的唯一写者
      handlers/
      web.ts
      pages/              ← React 页面（TanStack 文件路由）
      components/
      hooks/
      jobs.ts
      agent.ts            ← tools、materializers、roHints、AGENTS.md 片段
      tools/              ← defineAgentTool
      verbs/              ← defineCliVerb
      cli.ts              ← <module>Verbs barrel
      seed.ts
      defaults/           ← *.agent.yaml、*.schedule.yaml
      skills/             ← 内联 skill 内容
  src/                    ← 仅前端 shell
    main.tsx
    routeTree.gen.ts      ← 生成的 TanStack 路由树
    lib/
      api-client.ts       ← Hono RPC 客户端
    components/
      ui/                 ← shadcn/ui（你拥有）
      ai-elements/        ← AI 聊天 UI 组件（你拥有）
      data-table/         ← DiceUI data-table 组件
    shell/
      app-layout.tsx      ← 带侧边栏的主应用 shell
      command-palette.tsx
      auth/
      settings/
    hooks/
    styles/
    stores/
  tests/
    e2e/                  ← 真实 Postgres
    smoke/                ← 真实服务器、真实 LLM key
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
如果这个仓库帮到了你，请点个 Star
</p>

---

### 许可证

MIT。一切都属于你。
