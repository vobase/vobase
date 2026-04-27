#!/usr/bin/env bun
/**
 * CI lint — module shape invariants.
 *
 * Two layers:
 *
 * 1. Journal write-path guard (static grep). `messages` / `conversation_events`
 *    are write-once-path tables — only `modules/messaging/service/**` may
 *    `.insert/update/delete()` them. Cross-module callers route through the
 *    typed `appendJournalEvent` wrapper exported from
 *    `modules/messaging/service/journal.ts`. Prevents the dual-write class of
 *    bugs.
 *
 * 2. Module contract invariants — enforce the declarative-module-collector
 *    contract (Slice 4b). Loaded by importing `runtime/modules.ts`:
 *      - `agent.tools[i].name` unique across modules
 *      - `agent.commands[i].name` unique across modules
 *      - `jobs[i].name` unique across modules (excluding `disabled: true`)
 *      - Every `agent.listeners[slot][i]` is a function
 *      - Every `agent.materializers[i].path` is an absolute workspace path
 *      - Every `agent.materializers[i].phase` is one of the known enum values
 *      - `module.ts` contains no inline `tools: [...]` / `listeners: {...}` /
 *        `materializers: [...]` / `commands: [...]` / `sideLoad: [...]` literals
 *        at the `ModuleDef` level
 *      - `module.ts` contains no `ctx.register*` calls
 *
 * Tolerant of the partial-migration state: a module whose `agent` / `jobs`
 * surface is undefined skips the corresponding dynamic check.
 */

import { join } from 'node:path'

import { modules as registeredModules } from '../runtime/modules'

const TEMPLATE_ROOT = join(import.meta.dir, '..')
const MODULES_DIR = join(TEMPLATE_ROOT, 'modules')

interface LintError {
  file: string
  line?: number
  message: string
}

const errors: LintError[] = []

const JOURNAL_WRITE_RE = /\.(insert|update|delete)\s*\(\s*(messages|conversationEvents)\b/
const JOURNAL_WRITE_ALLOWED = ['modules/messaging/service/']

const THREADS_WRITE_RE = /\.(insert|update|delete)\s*\(\s*(agentThreads|agentThreadMessages)\b/
const THREADS_WRITE_ALLOWED = ['modules/agents/service/threads.ts']

const _CHANGES_WRITE_RE = /\.(insert|update|delete)\s*\(\s*(changeProposals|changeHistory)\b/
const _CHANGES_WRITE_ALLOWED = ['modules/changes/service/proposals.ts']

async function checkJournalWriteAuthority(): Promise<void> {
  const glob = new Bun.Glob('**/*.ts')
  for await (const entry of glob.scan({ cwd: MODULES_DIR })) {
    if (entry.endsWith('.test.ts') || entry.includes('__tests__/')) continue
    const fullPath = join(MODULES_DIR, entry)
    const relFromModules = `modules/${entry}`
    const lines = (await Bun.file(fullPath).text()).split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue
      if (!JOURNAL_WRITE_ALLOWED.some((prefix) => relFromModules.startsWith(prefix))) {
        const m = JOURNAL_WRITE_RE.exec(line)
        if (m) {
          errors.push({
            file: fullPath,
            line: i + 1,
            message: `writes to "${m[2]}" only allowed in messaging/service or agents/service/journal.ts (one-write-path)`,
          })
        }
      }
      if (!THREADS_WRITE_ALLOWED.some((p) => relFromModules === p)) {
        const m = THREADS_WRITE_RE.exec(line)
        if (m) {
          errors.push({
            file: fullPath,
            line: i + 1,
            message: `writes to "${m[2]}" only allowed in modules/agents/service/threads.ts (one-write-path)`,
          })
        }
      }
    }
  }
}

const MODULE_FILES = ['agents', 'contacts', 'drive', 'messaging', 'team']

const INLINE_LITERAL_RE = /^\s{2,}(tools|listeners|materializers|commands|sideLoad)\s*:\s*[[{]/
const CTX_REGISTER_RE = /ctx\.register[A-Z]\w*/

async function checkModuleTsShape(): Promise<void> {
  for (const mod of MODULE_FILES) {
    const path = join(MODULES_DIR, mod, 'module.ts')
    if (!(await Bun.file(path).exists())) continue
    const lines = (await Bun.file(path).text()).split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue
      if (INLINE_LITERAL_RE.test(line)) {
        const m = INLINE_LITERAL_RE.exec(line)
        errors.push({
          file: path,
          line: i + 1,
          message: `module.ts must be an aggregator; move \`${m?.[1]}:\` into sibling \`agent.ts\` and re-export`,
        })
      }
      if (CTX_REGISTER_RE.test(line)) {
        errors.push({
          file: path,
          line: i + 1,
          message: 'init(ctx) must not call ctx.register* — contributions belong on the ModuleDef itself',
        })
      }
    }
  }
}

interface MaterializerLike {
  path: unknown
  phase: unknown
  materialize?: unknown
}

interface AgentSurface {
  tools?: Array<{ name: unknown }>
  listeners?: Record<string, unknown>
  materializers?: MaterializerLike[]
  commands?: Array<{ name: unknown }>
  sideLoad?: unknown[]
}

interface JobLike {
  name: unknown
  handler?: unknown
  disabled?: unknown
}

interface ModuleLike {
  name: string
  agent?: AgentSurface
  jobs?: readonly JobLike[]
}

const VALID_PHASES = new Set(['frozen', 'side-load', 'on-read'])

function trackUnique(seen: Map<string, string>, kind: string, moduleName: string, name: unknown): void {
  if (typeof name !== 'string' || name.length === 0) {
    errors.push({
      file: `modules/${moduleName}`,
      message: `${kind} in module "${moduleName}" has a non-string/empty name`,
    })
    return
  }
  const prev = seen.get(name)
  if (prev !== undefined) {
    errors.push({
      file: `modules/${moduleName}`,
      message: `duplicate ${kind} name "${name}" declared by both "${prev}" and "${moduleName}"`,
    })
  } else {
    seen.set(name, moduleName)
  }
}

function checkModuleContracts(): void {
  const modules = registeredModules as unknown as readonly ModuleLike[]

  const toolNames = new Map<string, string>()
  const commandNames = new Map<string, string>()
  const jobNames = new Map<string, string>()

  for (const mod of modules) {
    const agent = mod.agent
    if (agent?.tools) {
      for (const tool of agent.tools) trackUnique(toolNames, 'tool', mod.name, tool?.name)
    }
    if (agent?.commands) {
      for (const cmd of agent.commands) trackUnique(commandNames, 'command', mod.name, cmd?.name)
    }
    if (agent?.listeners) {
      for (const [slot, list] of Object.entries(agent.listeners)) {
        if (list === undefined) continue
        if (!Array.isArray(list)) {
          errors.push({
            file: `modules/${mod.name}`,
            message: `listener slot "${slot}" must be an array of functions`,
          })
          continue
        }
        for (let i = 0; i < list.length; i++) {
          if (typeof list[i] !== 'function') {
            errors.push({
              file: `modules/${mod.name}`,
              message: `agent.listeners.${slot}[${i}] must be a function, got ${typeof list[i]}`,
            })
          }
        }
      }
    }
    if (agent?.materializers) {
      for (let i = 0; i < agent.materializers.length; i++) {
        const m = agent.materializers[i]
        if (typeof m.path !== 'string' || !m.path.startsWith('/')) {
          errors.push({
            file: `modules/${mod.name}`,
            message: `agent.materializers[${i}].path must be an absolute workspace path starting with "/", got ${JSON.stringify(m.path)}`,
          })
        }
        if (typeof m.phase !== 'string' || !VALID_PHASES.has(m.phase)) {
          errors.push({
            file: `modules/${mod.name}`,
            message: `agent.materializers[${i}].phase must be one of ${[...VALID_PHASES].join('|')}, got ${JSON.stringify(m.phase)}`,
          })
        }
        if (typeof m.materialize !== 'function') {
          errors.push({
            file: `modules/${mod.name}`,
            message: `agent.materializers[${i}].materialize must be a function`,
          })
        }
      }
    }
    if (mod.jobs) {
      for (const job of mod.jobs) {
        if (job.disabled === true) continue
        trackUnique(jobNames, 'job', mod.name, job.name)
      }
    }
  }
}

/**
 * Surface enforcement: every top-level route in `src/routes.ts` must appear in
 * the explicit allowlist below. Adding a new top-level route requires a
 * deliberate update to this list — preventing UI drift back to a
 * flat-everything URL space.
 *
 * Allowlist entries:
 *   - `/`                    — home redirect to /inbox
 *   - `/auth/*`              — login + pending (auth layout)
 *   - `/inbox`               — canonical messaging surface
 *   - `/messaging`           — legacy redirect → /inbox
 *   - `/settings`            — admin / personal settings (cross-cutting)
 *   - `/channels`            — admin (channel instances + adapter config)
 *   - `/system`              — system / health surface
 *   - `/test-web`, `/chat/$channelInstanceId` — public widget shell + chat
 *   - `/contacts`, `/team`, `/agents`, `/drive` — module-owned surfaces
 */
const ALLOWED_ROUTE_PREFIXES = [
  '/',
  '/auth',
  '/inbox',
  '/messaging',
  '/settings',
  '/channels',
  '/system',
  '/test-web',
  '/chat',
  '/contacts',
  '/team',
  '/agents',
  '/drive',
  '/changes',
]

const ROUTE_DECL_RE = /(?:route|physical)\s*\(\s*['"](\/[^'"]+)['"]/g

async function checkRouteSurfaces(): Promise<void> {
  const routesPath = join(TEMPLATE_ROOT, 'src', 'routes.ts')
  if (!(await Bun.file(routesPath).exists())) return
  const text = await Bun.file(routesPath).text()
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue
    ROUTE_DECL_RE.lastIndex = 0
    const matches = [...line.matchAll(ROUTE_DECL_RE)]
    for (const match of matches) {
      const path = match[1]
      const allowed = ALLOWED_ROUTE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
      if (!allowed) {
        errors.push({
          file: routesPath,
          line: i + 1,
          message: `route "${path}" must mount under /inbox, /workspace, or one of the explicit admin/auth allowlist prefixes — update ALLOWED_ROUTE_PREFIXES in scripts/check-module-shape.ts if this is a deliberate new top-level surface`,
        })
      }
    }
  }
}

await checkJournalWriteAuthority()
await checkModuleTsShape()
await checkRouteSurfaces()
checkModuleContracts()

if (errors.length > 0) {
  console.error('\ncheck-module-shape: FAILED\n')
  for (const err of errors) {
    const loc = err.line ? `${err.file}:${err.line}` : err.file
    console.error(`  ${loc}: ${err.message}`)
  }
  console.error(`\n${errors.length} error(s) found.`)
  process.exit(1)
}

console.log('check-module-shape: OK')
process.exit(0)
