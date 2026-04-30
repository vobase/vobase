/**
 * Canary snapshot for frozen-prompt + tool-surface drift.
 *
 * `systemHash` is SHA-256 over the rendered frozen markdown; tool schemas
 * aren't folded in (pi-agent-core concatenates them downstream), so the tool
 * surface is captured as a second fixture. Each fixture update is a
 * prefix-cache invalidation for every in-flight wake.
 */

import { describe, expect, it } from 'bun:test'
import { messagingTools } from '@modules/messaging/agent'
import { Bash, InMemoryFs } from 'just-bash'

import { resolvePlatformHint } from '~/wake/platform-hints'
import { buildFrozenPrompt, type SessionContext } from '~/wake/prompt'

/** Pinned SHA-256 of the canonical frozen prompt below. */
const SYSTEM_HASH_FIXTURE = '60ed086992a0f4adad9c6b0a7b3b0f2f0bd85f04cc7e19b4887cda2f4c96cd4b'

/** Tool names surfaced through `collectAgentContributions` to the harness. */
const TOOL_SURFACE_FIXTURE = ['reply', 'send_card', 'send_file', 'book_slot', 'add_note'] as const

const CANONICAL_AGENTS_MD = `# Canonical Test Agent (a_canon0001)

You operate inside a virtual workspace. Commands are vobase CLI verbs.

## Instructions

Be helpful. Respond concisely.
`

const CANONICAL_MEMORY_MD = `# Working Memory

- Established customer-first stance in prior wakes.
`

const CANONICAL_BUSINESS_MD = `# Business Profile

Acme Co — widgets and sprockets since 1998.
`

const CANONICAL_AGENT_DEFINITION = {
  id: 'a_canon0001',
  organizationId: 'org_canon001',
  name: 'Canonical Test Agent',
  slug: 'canonical',
  model: 'gpt-4o',
  instructions: 'Be helpful. Respond concisely.',
  workingMemory: '',
  scorerConfig: {},
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
} as never

const CANONICAL_SESSION_CONTEXT: SessionContext = {
  channelKind: 'whatsapp',
  channelLabel: 'Support WA',
  contactDisplayName: 'Alice',
  contactIdentifier: '+6598765432',
  staffAssigneeDisplayName: null,
  conversationStatus: 'open',
  customerSince: new Date('2025-11-03T00:00:00Z'),
}

async function buildCanonicalFrozenPrompt() {
  const fs = new InMemoryFs()
  await fs.mkdir('/agents/a_canon0001', { recursive: true })
  await fs.mkdir('/drive', { recursive: true })
  await fs.writeFile('/agents/a_canon0001/AGENTS.md', CANONICAL_AGENTS_MD)
  await fs.writeFile('/agents/a_canon0001/MEMORY.md', CANONICAL_MEMORY_MD)
  await fs.writeFile('/drive/BUSINESS.md', CANONICAL_BUSINESS_MD)

  const bash = new Bash({ fs })

  return buildFrozenPrompt({
    bash,
    agentDefinition: CANONICAL_AGENT_DEFINITION,
    organizationId: 'org_canon001',
    contactId: 'c_canon00001',
    channelInstanceId: 'ci_canon00',
    sessionContext: CANONICAL_SESSION_CONTEXT,
    platformHint: resolvePlatformHint('whatsapp'),
  })
}

describe('system-hash snapshot', () => {
  it('canonical wake produces the pinned systemHash', async () => {
    const { systemHash } = await buildCanonicalFrozenPrompt()
    expect(systemHash).toBe(SYSTEM_HASH_FIXTURE)
  })

  it('is stable across repeated renders (frozen invariant)', async () => {
    const a = await buildCanonicalFrozenPrompt()
    const b = await buildCanonicalFrozenPrompt()
    expect(a.systemHash).toBe(b.systemHash)
  })
})

describe('tool surface snapshot', () => {
  it('current conversation-lane tool surface matches the fixture', () => {
    const names = messagingTools.filter((t) => t.lane === 'conversation' || t.lane === 'both').map((t) => t.name)
    expect(names).toEqual([...TOOL_SURFACE_FIXTURE])
  })
})
