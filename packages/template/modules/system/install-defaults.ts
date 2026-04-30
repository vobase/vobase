/**
 * `vobase install --defaults` runner.
 *
 * Walks `modules/<m>/defaults/` for every module and installs each file
 * idempotently:
 *
 *   - `*.skill.md`     ↦ copies to `modules/<m>/skills/<basename>.md`
 *                        (skipped if already present unless --upgrade)
 *   - `*.agent.yaml`   ↦ creates a row in `agent_definitions` keyed on `name`
 *                        if no row with that name exists in the org.
 *   - `*.schedule.yaml`↦ creates a row in `agent_schedules` keyed on
 *                        `(organizationId, agentId, slug)` if no match exists.
 *
 * `--upgrade` re-considers existing rows whose `origin === 'file'`. The
 * stricter origin-aware semantics (and `--prune`) ship alongside schema
 * additions in a follow-up; for now we expose the same flags so the catalog
 * surface stays stable.
 *
 * The install is **dev-environment-aware**: it reads from `process.cwd()`
 * which expects the template source tree to be present. Production
 * deployments that run `install --defaults` should run from the build root
 * where `modules/<m>/defaults/` is reachable.
 */

import { readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import * as agentDefs from '@modules/agents/service/agent-definitions'
import { schedules as schedulesSvc } from '@modules/schedules/service/schedules'
import { z } from 'zod'

interface InstallEntry {
  module: string
  kind: 'skill' | 'agent' | 'schedule'
  source: string
  status: 'installed' | 'skipped' | 'failed'
  reason?: string
}

export interface InstallResult {
  upgraded: boolean
  scanned: number
  installed: number
  skipped: number
  failed: number
  entries: InstallEntry[]
}

const SKILL_SUFFIX = '.skill.md'
const AGENT_SUFFIX = '.agent.yaml'
const SCHEDULE_SUFFIX = '.schedule.yaml'

function parseYaml(text: string): unknown {
  return (Bun as unknown as { YAML: { parse(s: string): unknown } }).YAML.parse(text)
}

const AgentDefinitionFile = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1),
  model: z.string().min(1).optional(),
  instructions: z.string().optional(),
  workingMemory: z.string().optional(),
  enabled: z.boolean().optional(),
})

const ScheduleFile = z.object({
  organizationId: z.string().min(1),
  agentId: z.string().min(1),
  slug: z.string().min(1),
  cron: z.string().min(1),
  timezone: z.string().optional(),
})

type AgentRow = Awaited<ReturnType<typeof agentDefs.list>>[number]
type ScheduleRow = Awaited<ReturnType<typeof schedulesSvc.listEnabled>>[number]

class AgentIndex {
  private cache = new Map<string, AgentRow[]>()

  async byOrgAndName(organizationId: string, name: string): Promise<AgentRow | undefined> {
    let rows = this.cache.get(organizationId)
    if (!rows) {
      rows = await agentDefs.list(organizationId)
      this.cache.set(organizationId, rows)
    }
    return rows.find((a) => a.name === name)
  }

  invalidate(organizationId: string): void {
    this.cache.delete(organizationId)
  }
}

class ScheduleIndex {
  private cache = new Map<string, ScheduleRow[]>()

  async byOrg(organizationId: string, agentId: string, slug: string): Promise<ScheduleRow | undefined> {
    let rows = this.cache.get(organizationId)
    if (!rows) {
      rows = await schedulesSvc.listEnabled({ organizationId })
      this.cache.set(organizationId, rows)
    }
    return rows.find((s) => s.agentId === agentId && s.slug === slug)
  }

  invalidate(organizationId: string): void {
    this.cache.delete(organizationId)
  }
}

export async function runDefaultsInstall(opts: { upgrade: boolean; prune: boolean }): Promise<InstallResult> {
  const result: InstallResult = {
    upgraded: opts.upgrade,
    scanned: 0,
    installed: 0,
    skipped: 0,
    failed: 0,
    entries: [],
  }
  const modulesRoot = await resolveModulesRoot()
  if (!modulesRoot) {
    throw new Error(
      `vobase install: could not locate the modules/ directory from ${process.cwd()} — run from the template root`,
    )
  }
  const agents = new AgentIndex()
  const schedules = new ScheduleIndex()
  const moduleDirs = await safeReaddir(modulesRoot)
  for (const m of moduleDirs) {
    const defaultsDir = join(modulesRoot, m, 'defaults')
    if (!(await isDir(defaultsDir))) continue
    const skillsDir = join(modulesRoot, m, 'skills')
    for (const file of await safeReaddir(defaultsDir)) {
      const abs = join(defaultsDir, file)
      result.scanned += 1
      try {
        if (file.endsWith(SKILL_SUFFIX)) {
          const status = await installSkill({ abs, file, skillsDir, upgrade: opts.upgrade })
          recordEntry(result, { module: m, kind: 'skill', source: file, status })
        } else if (file.endsWith(AGENT_SUFFIX)) {
          const status = await installAgent({ abs, file, upgrade: opts.upgrade, agents })
          recordEntry(result, { module: m, kind: 'agent', source: file, status })
        } else if (file.endsWith(SCHEDULE_SUFFIX)) {
          const status = await installSchedule({ abs, file, upgrade: opts.upgrade, schedules })
          recordEntry(result, { module: m, kind: 'schedule', source: file, status })
        } else {
          result.skipped += 1
          result.entries.push({
            module: m,
            kind: 'skill',
            source: file,
            status: 'skipped',
            reason: 'unknown extension',
          })
        }
      } catch (err) {
        result.failed += 1
        result.entries.push({
          module: m,
          kind: 'skill',
          source: file,
          status: 'failed',
          reason: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
  if (opts.prune) {
    // --prune semantics ship alongside the origin column in a follow-up.
    // For now the flag is recognised but no rows are soft-deleted.
  }
  return result
}

function recordEntry(
  result: InstallResult,
  partial: { module: string; kind: 'skill' | 'agent' | 'schedule'; source: string; status: 'installed' | 'skipped' },
): void {
  if (partial.status === 'installed') result.installed += 1
  else result.skipped += 1
  result.entries.push(partial)
}

async function installSkill(opts: {
  abs: string
  file: string
  skillsDir: string
  upgrade: boolean
}): Promise<'installed' | 'skipped'> {
  const targetName = `${opts.file.slice(0, -SKILL_SUFFIX.length)}.md`
  const targetAbs = join(opts.skillsDir, targetName)
  const exists = await Bun.file(targetAbs).exists()
  if (exists && !opts.upgrade) return 'skipped'
  const content = await Bun.file(opts.abs).text()
  await Bun.write(targetAbs, content)
  return 'installed'
}

async function installAgent(opts: {
  abs: string
  file: string
  upgrade: boolean
  agents: AgentIndex
}): Promise<'installed' | 'skipped'> {
  const yaml = parseYaml(await Bun.file(opts.abs).text())
  const parsed = AgentDefinitionFile.safeParse(yaml)
  if (!parsed.success) throw new Error(`invalid agent yaml in ${opts.file}: ${parsed.error.message}`)
  const def = parsed.data
  const match = await opts.agents.byOrgAndName(def.organizationId, def.name)
  if (match && !opts.upgrade) return 'skipped'
  if (match) {
    await agentDefs.update(match.id, {
      instructions: def.instructions ?? '',
      workingMemory: def.workingMemory ?? '',
      model: def.model,
      enabled: def.enabled ?? true,
    })
    return 'installed'
  }
  await agentDefs.create(def)
  opts.agents.invalidate(def.organizationId)
  return 'installed'
}

async function installSchedule(opts: {
  abs: string
  file: string
  upgrade: boolean
  schedules: ScheduleIndex
}): Promise<'installed' | 'skipped'> {
  const yaml = parseYaml(await Bun.file(opts.abs).text())
  const parsed = ScheduleFile.safeParse(yaml)
  if (!parsed.success) throw new Error(`invalid schedule yaml in ${opts.file}: ${parsed.error.message}`)
  const def = parsed.data
  const match = await opts.schedules.byOrg(def.organizationId, def.agentId, def.slug)
  if (match && !opts.upgrade) return 'skipped'
  if (match) {
    // Re-enable + record the new cron is a follow-up; for now we leave the existing row alone in upgrade mode.
    return 'skipped'
  }
  await schedulesSvc.create(def)
  opts.schedules.invalidate(def.organizationId)
  return 'installed'
}

async function resolveModulesRoot(): Promise<string | null> {
  const candidates = [join(process.cwd(), 'modules'), join(process.cwd(), 'packages', 'template', 'modules')]
  for (const c of candidates) {
    if (await isDir(c)) return c
  }
  return null
}

async function safeReaddir(path: string): Promise<string[]> {
  try {
    return await readdir(path)
  } catch {
    return []
  }
}

async function isDir(path: string): Promise<boolean> {
  try {
    const s = await stat(path)
    return s.isDirectory()
  } catch {
    return false
  }
}

export { basename }
