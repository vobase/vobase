import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { __resetOverlaysForTests } from '@modules/drive/service/overlays'
import { formatProviderId } from '@modules/drive/service/virtual-ids'

import { installAgentDefinitionsService } from './agent-definitions'
import { installAgentSkillsService } from './changes'
import { agentSkillsOverlay, SKILLS_PROVIDER_ID } from './drive-overlay'

const ORG_A = 'org-aaa'
const ORG_B = 'org-bbb'
const AGENT_A = 'agent-111'
const AGENT_B = 'agent-222'

function makeAgent(id: string, orgId: string, skillAllowlist: string[] = [], updatedAt?: Date) {
  return {
    id,
    organizationId: orgId,
    skillAllowlist,
    instructions: '',
    workingMemory: '',
    updatedAt: updatedAt ?? new Date('2026-01-01T00:00:00Z'),
  }
}

function makeSkill(name: string, agentId: string | null, body = '', updatedAt: Date = new Date()) {
  return {
    id: `skill-${name}`,
    organizationId: ORG_A,
    agentId,
    name,
    description: name,
    body,
    parentProposalId: null,
    updatedAt,
  }
}

function agentScope(agentId: string) {
  return { scope: 'agent' as const, agentId }
}

beforeEach(() => {
  installAgentDefinitionsService({
    getById: async (id) => {
      if (id === AGENT_A) return makeAgent(AGENT_A, ORG_A, ['read', 'write']) as never
      if (id === AGENT_B) return makeAgent(AGENT_B, ORG_B) as never
      throw new Error(`agent not found: ${id}`)
    },
    create: mock(() => Promise.resolve({} as never)),
    update: mock(() => Promise.resolve({} as never)),
    remove: mock(() => Promise.resolve()),
    list: mock(() => Promise.resolve([])),
    getConversationWorkingMemory: mock(() => Promise.resolve(null)),
  })

  installAgentSkillsService({
    listSkillsForAgent: async ({ agentId }) => {
      if (agentId === AGENT_A) return [makeSkill('read', AGENT_A, '# Read skill'), makeSkill('extra', null, '# Extra')]
      return []
    },
  })
})

afterEach(() => {
  __resetOverlaysForTests()
})

describe('agentSkillsOverlay.list', () => {
  it('returns /skills folder at root when agent has skills', async () => {
    const rows = await agentSkillsOverlay.list({
      scope: agentScope(AGENT_A),
      parentId: null,
      organizationId: ORG_A,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].path).toBe('/skills')
    expect(rows[0].kind).toBe('folder')
    expect(rows[0].id).toBe(formatProviderId(SKILLS_PROVIDER_ID, AGENT_A, 'dir'))
  })

  it('returns empty array at root when agent has no skills', async () => {
    installAgentDefinitionsService({
      getById: async (id) => {
        if (id === AGENT_B) return makeAgent(AGENT_B, ORG_B, []) as never
        throw new Error(`agent not found: ${id}`)
      },
      create: mock(() => Promise.resolve({} as never)),
      update: mock(() => Promise.resolve({} as never)),
      remove: mock(() => Promise.resolve()),
      list: mock(() => Promise.resolve([])),
      getConversationWorkingMemory: mock(() => Promise.resolve(null)),
    })
    installAgentSkillsService({ listSkillsForAgent: async () => [] })

    const rows = await agentSkillsOverlay.list({
      scope: agentScope(AGENT_B),
      parentId: null,
      organizationId: ORG_B,
    })
    expect(rows).toHaveLength(0)
  })

  it('returns skill files inside /skills folder, deduplicated', async () => {
    const dirId = formatProviderId(SKILLS_PROVIDER_ID, AGENT_A, 'dir')
    const rows = await agentSkillsOverlay.list({
      scope: agentScope(AGENT_A),
      parentId: dirId,
      organizationId: ORG_A,
    })
    // allowlist: ['read', 'write'] + learned: ['read'(shadow), 'extra']
    // deduped: read, write, extra
    expect(rows).toHaveLength(3)
    const paths = rows.map((r) => r.path).sort()
    expect(paths).toEqual(['/skills/extra.md', '/skills/read.md', '/skills/write.md'])
    for (const row of rows) {
      expect(row.kind).toBe('file')
      expect(row.parentFolderId).toBe(dirId)
    }
  })

  it('cross-org isolation: returns empty for wrong org', async () => {
    // AGENT_A belongs to ORG_A; requesting with ORG_B should return nothing
    const rows = await agentSkillsOverlay.list({
      scope: agentScope(AGENT_A),
      parentId: null,
      organizationId: ORG_B,
    })
    expect(rows).toHaveLength(0)
  })
})

describe('agentSkillsOverlay.read', () => {
  it('returns body for a learned skill', async () => {
    const result = await agentSkillsOverlay.read({
      scope: agentScope(AGENT_A),
      path: '/skills/read.md',
      organizationId: ORG_A,
    })
    expect(result).not.toBeNull()
    expect(result?.content).toBe('# Read skill')
  })

  it('returns placeholder for allowlisted skill with no body', async () => {
    const result = await agentSkillsOverlay.read({
      scope: agentScope(AGENT_A),
      path: '/skills/write.md',
      organizationId: ORG_A,
    })
    expect(result).not.toBeNull()
    expect(result?.content).toContain('allow-listed')
    expect(result?.content).toContain('write')
  })

  it('returns org-floating learned skill not in allowlist', async () => {
    const result = await agentSkillsOverlay.read({
      scope: agentScope(AGENT_A),
      path: '/skills/extra.md',
      organizationId: ORG_A,
    })
    expect(result).not.toBeNull()
    expect(result?.content).toBe('# Extra')
  })

  it('returns null for unknown skill', async () => {
    const result = await agentSkillsOverlay.read({
      scope: agentScope(AGENT_A),
      path: '/skills/nonexistent.md',
      organizationId: ORG_A,
    })
    expect(result).toBeNull()
  })

  it('returns null for non-skills path', async () => {
    const result = await agentSkillsOverlay.read({
      scope: agentScope(AGENT_A),
      path: '/AGENTS.md',
      organizationId: ORG_A,
    })
    expect(result).toBeNull()
  })

  it('cross-org isolation: returns null for wrong org', async () => {
    const result = await agentSkillsOverlay.read({
      scope: agentScope(AGENT_A),
      path: '/skills/read.md',
      organizationId: ORG_B,
    })
    expect(result).toBeNull()
  })

  it('returns updatedAt from the learned skill row', async () => {
    const skillTs = new Date('2026-03-10T08:00:00Z')
    installAgentSkillsService({
      listSkillsForAgent: async () => [makeSkill('extra', AGENT_A, '# Extra', skillTs)],
    })
    const result = await agentSkillsOverlay.read({
      scope: agentScope(AGENT_A),
      path: '/skills/extra.md',
      organizationId: ORG_A,
    })
    expect(result?.updatedAt?.getTime()).toBe(skillTs.getTime())
  })

  it('falls back to agent.updatedAt for allowlisted placeholder skills with no learned row', async () => {
    const agentTs = new Date('2026-02-02T00:00:00Z')
    installAgentDefinitionsService({
      getById: async () => makeAgent(AGENT_A, ORG_A, ['write'], agentTs) as never,
      create: mock(() => Promise.resolve({} as never)),
      update: mock(() => Promise.resolve({} as never)),
      remove: mock(() => Promise.resolve()),
      list: mock(() => Promise.resolve([])),
      getConversationWorkingMemory: mock(() => Promise.resolve(null)),
    })
    installAgentSkillsService({ listSkillsForAgent: async () => [] })
    const result = await agentSkillsOverlay.read({
      scope: agentScope(AGENT_A),
      path: '/skills/write.md',
      organizationId: ORG_A,
    })
    expect(result?.updatedAt?.getTime()).toBe(agentTs.getTime())
  })
})
