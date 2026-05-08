/**
 * Drive overlay provider for the `agents/skills` virtual subtree.
 *
 * Layout follows the [agentskills.io specification](https://agentskills.io/specification):
 * each skill is a folder containing a `SKILL.md` file with YAML
 * frontmatter (today only `name` and `description` — additional fields
 * like triggers/globs/license land later).
 *
 * Contributes to the `agent` drive scope:
 *   - `/skills/` folder (synthetic, at root parentId=null)
 *   - `/skills/<name>/` folders (one per allowlisted or learned skill)
 *   - `/skills/<name>/SKILL.md` files
 *
 * Virtual id format (via formatProviderId):
 *   `virtual:provider:agents/skills:<agentId>:dir`             ← the /skills folder
 *   `virtual:provider:agents/skills:<agentId>:sub:<name>`      ← per-skill folder
 *   `virtual:provider:agents/skills:<agentId>:leaf:<name>`     ← SKILL.md inside
 *
 * Cross-org isolation: every DB read filters by `ctx.organizationId` AND
 * verifies `agentDefinitions.organizationId === ctx.organizationId` before
 * returning any rows. Returning another org's data is Sev-1.
 */

import type { DriveFile } from '@modules/drive/schema'
import {
  type DriveOverlayContext,
  type DriveOverlayProvider,
  type DriveOverlayReadContext,
  makeProviderRow,
} from '@modules/drive/service/overlays'
import { formatProviderId } from '@modules/drive/service/virtual-ids'

import * as agentDefs from './agent-definitions'
import { listSkillsForAgent } from './changes'

export const SKILLS_PROVIDER_ID = 'agents/skills'

const SKILLS_DIR_PATH = '/skills'
const SKILLS_DIR_NAME = 'skills'
const SKILL_FILE_NAME = 'SKILL.md'

function skillFolderPath(name: string): string {
  return `/skills/${name}`
}

function skillFilePath(name: string): string {
  return `/skills/${name}/SKILL.md`
}

/** Render SKILL.md per agentskills.io spec — frontmatter is `name` + `description` only today. */
function renderSkillMd(name: string, description: string | null | undefined, body: string): string {
  const desc = (description ?? '').trim() || `Skill: ${name}`
  const safeDesc = `"${desc.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  const frontmatter = ['---', `name: ${name}`, `description: ${safeDesc}`, '---', ''].join('\n')
  return `${frontmatter}\n${body}\n`
}

function skillBody(name: string, body: string | null | undefined, inAllowlist: boolean): string {
  if (body && body.trim().length > 0) return body
  if (inAllowlist) {
    return `Skill "${name}" is allow-listed for this agent. Source body lives at modules/<m>/skills/${name}.md.`
  }
  return `Skill "${name}" — empty body.`
}

function makeSkillsDirRow(organizationId: string, agentId: string, updatedAt: Date): DriveFile {
  return makeProviderRow({
    kind: 'folder',
    providerId: SKILLS_PROVIDER_ID,
    scope: 'agent',
    scopeId: agentId,
    organizationId,
    parentFolderId: null,
    name: SKILLS_DIR_NAME,
    path: SKILLS_DIR_PATH,
    key: 'dir',
    updatedAt,
  })
}

function makeSkillFolderRow(
  organizationId: string,
  agentId: string,
  name: string,
  parentId: string,
  updatedAt: Date,
): DriveFile {
  return makeProviderRow({
    kind: 'folder',
    providerId: SKILLS_PROVIDER_ID,
    scope: 'agent',
    scopeId: agentId,
    organizationId,
    parentFolderId: parentId,
    name,
    path: skillFolderPath(name),
    key: `sub:${name}`,
    updatedAt,
  })
}

function makeSkillFileRow(
  organizationId: string,
  agentId: string,
  name: string,
  parentSubdirId: string,
  updatedAt: Date,
): DriveFile {
  return makeProviderRow({
    kind: 'file',
    providerId: SKILLS_PROVIDER_ID,
    scope: 'agent',
    scopeId: agentId,
    organizationId,
    parentFolderId: parentSubdirId,
    name: SKILL_FILE_NAME,
    path: skillFilePath(name),
    key: `leaf:${name}`,
    updatedAt,
  })
}

export const agentSkillsOverlay: DriveOverlayProvider = {
  id: SKILLS_PROVIDER_ID,
  appliesTo: ['agent'],

  async list(ctx: DriveOverlayContext): Promise<DriveFile[]> {
    if (ctx.scope.scope !== 'agent') return []
    const agentId = ctx.scope.agentId
    const { organizationId } = ctx

    // Cross-org isolation: verify agent belongs to this org
    const agent = await agentDefs.getById(agentId)
    if (agent.organizationId !== organizationId) return []

    const dirId = formatProviderId(SKILLS_PROVIDER_ID, agentId, 'dir')
    const agentUpdatedAt = agent.updatedAt ?? new Date(0)

    if (ctx.parentId === null) {
      // Root listing: emit the /skills folder if there are any skills
      const allowlist = agent.skillAllowlist ?? []
      const learned = await listSkillsForAgent({ organizationId, agentId })
      if (allowlist.length === 0 && learned.length === 0) return []
      // Folder updatedAt = max of agent.updatedAt and any learned-skill updatedAt.
      const folderUpdatedAt = learned.reduce<Date>(
        (acc, s) => (s.updatedAt && s.updatedAt > acc ? s.updatedAt : acc),
        agentUpdatedAt,
      )
      return [makeSkillsDirRow(organizationId, agentId, folderUpdatedAt)]
    }

    if (ctx.parentId === dirId) {
      // /skills/ listing: emit one folder per deduplicated skill (per spec).
      const allowlist = agent.skillAllowlist ?? []
      const learned = await listSkillsForAgent({ organizationId, agentId })
      const skillsByName = new Map(learned.map((s) => [s.name, s]))
      const seen = new Set<string>()
      const rows: DriveFile[] = []

      for (const name of allowlist) {
        seen.add(name)
        const learnedShadow = skillsByName.get(name)
        const ts = learnedShadow?.updatedAt ?? agentUpdatedAt
        rows.push(makeSkillFolderRow(organizationId, agentId, name, dirId, ts))
      }
      for (const skill of learned) {
        if (seen.has(skill.name)) continue
        rows.push(makeSkillFolderRow(organizationId, agentId, skill.name, dirId, skill.updatedAt ?? agentUpdatedAt))
      }

      return rows
    }

    // Per-skill folder listing: emit the SKILL.md leaf.
    const subPrefix = `virtual:provider:${SKILLS_PROVIDER_ID}:${agentId}:sub:`
    if (typeof ctx.parentId === 'string' && ctx.parentId.startsWith(subPrefix)) {
      const name = ctx.parentId.slice(subPrefix.length)
      const allowlist = agent.skillAllowlist ?? []
      const inAllowlist = allowlist.includes(name)
      const learned = await listSkillsForAgent({ organizationId, agentId })
      const skill = learned.find((s) => s.name === name)
      if (!inAllowlist && !skill) return []
      const ts = skill?.updatedAt ?? agentUpdatedAt
      return [makeSkillFileRow(organizationId, agentId, name, ctx.parentId, ts)]
    }

    return []
  },

  async read(ctx: DriveOverlayReadContext): Promise<{ content: string; updatedAt?: Date } | null> {
    if (ctx.scope.scope !== 'agent') return null
    const agentId = ctx.scope.agentId
    const { organizationId, path } = ctx

    // Per the agentskills.io spec, the served file is `/skills/<name>/SKILL.md`.
    const SKILL_SUFFIX = `/${SKILL_FILE_NAME}`
    if (!path.startsWith('/skills/') || !path.endsWith(SKILL_SUFFIX)) return null

    // Cross-org isolation
    const agent = await agentDefs.getById(agentId)
    if (agent.organizationId !== organizationId) return null

    const name = path.slice('/skills/'.length, -SKILL_SUFFIX.length)
    if (!name || name.includes('/')) return null

    const allowlist = agent.skillAllowlist ?? []
    const inAllowlist = allowlist.includes(name)

    const learned = await listSkillsForAgent({ organizationId, agentId })
    const skill = learned.find((s) => s.name === name)

    // Only serve if the skill is known (allowlisted or has a learned row)
    if (!inAllowlist && !skill) return null

    const updatedAt = skill?.updatedAt ?? agent.updatedAt ?? new Date(0)
    const body = skillBody(name, skill?.body, inAllowlist)
    return { content: renderSkillMd(name, skill?.description, body), updatedAt }
  },
}
