/**
 * Drive overlay provider for the `agents/skills` virtual subtree.
 *
 * Contributes to the `agent` drive scope:
 *   - `/skills/` folder (synthetic, at root parentId=null)
 *   - `/skills/<name>.md` files (one per allowlisted or learned skill)
 *
 * Virtual id format (via formatProviderId):
 *   `virtual:provider:agents/skills:<agentId>:dir`         ← the /skills folder
 *   `virtual:provider:agents/skills:<agentId>:leaf:<name>` ← per-skill file
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

function skillFilePath(name: string): string {
  return `/skills/${name}.md`
}

function skillFileName(name: string): string {
  return `${name}.md`
}

function skillContent(name: string, body: string | null | undefined, inAllowlist: boolean): string {
  if (body && body.trim().length > 0) return body
  if (inAllowlist) {
    return `Skill "${name}" is allow-listed for this agent. Source body ships via \`vobase install --defaults\` (modules/<m>/defaults/${name}.skill.md).`
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

function makeSkillFileRow(
  organizationId: string,
  agentId: string,
  name: string,
  dirId: string,
  updatedAt: Date,
): DriveFile {
  return makeProviderRow({
    kind: 'file',
    providerId: SKILLS_PROVIDER_ID,
    scope: 'agent',
    scopeId: agentId,
    organizationId,
    parentFolderId: dirId,
    name: skillFileName(name),
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
      // Skills folder listing: emit one file per deduplicated skill
      const allowlist = agent.skillAllowlist ?? []
      const learned = await listSkillsForAgent({ organizationId, agentId })
      const skillsByName = new Map(learned.map((s) => [s.name, s]))
      const seen = new Set<string>()
      const rows: DriveFile[] = []

      for (const name of allowlist) {
        seen.add(name)
        // Allowlist placeholders fall back to the agent's updatedAt; if a
        // learned skill shadows the allowlist entry, prefer its timestamp.
        const learnedShadow = skillsByName.get(name)
        const ts = learnedShadow?.updatedAt ?? agentUpdatedAt
        rows.push(makeSkillFileRow(organizationId, agentId, name, dirId, ts))
      }
      for (const skill of learned) {
        if (seen.has(skill.name)) continue
        rows.push(makeSkillFileRow(organizationId, agentId, skill.name, dirId, skill.updatedAt ?? agentUpdatedAt))
      }

      return rows
    }

    return []
  },

  async read(ctx: DriveOverlayReadContext): Promise<{ content: string; updatedAt?: Date } | null> {
    if (ctx.scope.scope !== 'agent') return null
    const agentId = ctx.scope.agentId
    const { organizationId, path } = ctx

    if (!path.startsWith('/skills/') || !path.endsWith('.md')) return null

    // Cross-org isolation
    const agent = await agentDefs.getById(agentId)
    if (agent.organizationId !== organizationId) return null

    const name = path.slice('/skills/'.length, -'.md'.length)
    if (!name) return null

    const allowlist = agent.skillAllowlist ?? []
    const inAllowlist = allowlist.includes(name)

    const learned = await listSkillsForAgent({ organizationId, agentId })
    const skill = learned.find((s) => s.name === name)

    // Only serve if the skill is known (allowlisted or has a learned row)
    if (!inAllowlist && !skill) return null

    const updatedAt = skill?.updatedAt ?? agent.updatedAt ?? new Date(0)
    return { content: skillContent(name, skill?.body, inAllowlist), updatedAt }
  },
}
