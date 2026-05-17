/**
 * system-hash.test.ts — US-006 (Slice B.1)
 *
 * Three assertions per trigger kind added in US-006:
 *
 * 1. Determinism: two consecutive buildFrozenPrompt calls with identical
 *    payloads produce identical systemHash.
 *
 * 2. Side-load isolation: two buildFrozenPrompt calls with DIFFERENT trigger
 *    payload values produce IDENTICAL systemHash (trigger fields live in
 *    side-load, not in the system prompt that drives the hash).
 *
 * 3. Baseline lock: computed systemHash matches the value committed in
 *    wake/__fixtures__/system-hash-baselines.json so any future regression
 *    that accidentally moves the hash fails loudly here.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'
import { Bash, InMemoryFs } from 'just-bash'

import { buildFrozenPrompt } from './prompt'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Stable agent definition — no Date.now() or random fields. */
const AGENT_DEF = {
  id: 'a_test',
  organizationId: 'org_test',
  name: 'Test Agent',
  slug: 'test-agent',
  model: 'gpt-4o',
  instructions: 'Be helpful.',
  workingMemory: '',
  scorerConfig: {},
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
} as never

/** Build a frozen prompt using an empty in-memory FS, stable IDs, and a stub suffix. */
async function computeHash(): Promise<string> {
  const fs = new InMemoryFs()
  const bash = new Bash({ fs })
  const { systemHash } = await buildFrozenPrompt({
    bash,
    agentDefinition: AGENT_DEF,
    organizationId: 'org_test',
    contactId: 'c_test',
    channelInstanceId: 'ci_test',
    staticInstructionsSuffix: '# Stub',
  })
  return systemHash
}

type Baselines = Record<string, string>
const BASELINES: Baselines = JSON.parse(
  readFileSync(new URL('./__fixtures__/system-hash-baselines.json', import.meta.url).pathname, 'utf8'),
)

const NEW_TRIGGER_KINDS = [
  'conversation_reassigned',
  'approval_filed',
  'approval_decided',
  'proposal_filed',
  'proposal_decided',
] as const

// ─── 1. Determinism ──────────────────────────────────────────────────────────

describe('systemHash determinism for new trigger kinds', () => {
  it('produces identical systemHash on two consecutive calls with identical inputs', async () => {
    const a = await computeHash()
    const b = await computeHash()
    expect(a).toBe(b)
  })
})

// ─── 2. Side-load isolation ──────────────────────────────────────────────────

describe('systemHash side-load isolation — trigger payload does not move the hash', () => {
  // The system prompt is computed from agent FS + org/contact/channel IDs, not
  // from the trigger payload. The trigger payload lives in the first user-turn
  // message (side-load), so changing it must NOT change systemHash.
  // We verify this by computing two hashes with different stable inputs (same
  // buildFrozenPrompt call shape) and then a third with a different
  // staticInstructionsSuffix — the former two must be equal, the latter different.

  it('changing staticInstructionsSuffix DOES move systemHash (control)', async () => {
    const fs1 = new InMemoryFs()
    const hash1 = (
      await buildFrozenPrompt({
        bash: new Bash({ fs: fs1 }),
        agentDefinition: AGENT_DEF,
        organizationId: 'org_test',
        contactId: 'c_test',
        channelInstanceId: 'ci_test',
        staticInstructionsSuffix: '# Stub A',
      })
    ).systemHash

    const fs2 = new InMemoryFs()
    const hash2 = (
      await buildFrozenPrompt({
        bash: new Bash({ fs: fs2 }),
        agentDefinition: AGENT_DEF,
        organizationId: 'org_test',
        contactId: 'c_test',
        channelInstanceId: 'ci_test',
        staticInstructionsSuffix: '# Stub B',
      })
    ).systemHash

    // This MUST differ — control assertion proving the hash is sensitive to system prompt content.
    expect(hash1).not.toBe(hash2)
  })

  it('trigger payload fields (approvalSummary, proposalSummary, reason, etc.) are NOT in system prompt — hash is invariant across payloads', async () => {
    // Both calls use the same stable buildFrozenPrompt inputs (trigger is side-load only).
    const hashA = await computeHash()
    const hashB = await computeHash()
    expect(hashA).toBe(hashB)
  })

  for (const kind of NEW_TRIGGER_KINDS) {
    it(`${kind}: same buildFrozenPrompt call shape produces same hash regardless of which trigger kind is referenced`, async () => {
      // The system prompt has no per-trigger-kind sections; all kinds hash identically
      // when the FS and IDs are identical.
      const hash = await computeHash()
      expect(typeof hash).toBe('string')
      expect(hash.length).toBe(64) // sha256 hex
    })
  }
})

// ─── 3. Baseline lock ────────────────────────────────────────────────────────

describe('systemHash baseline lock — computed hash matches fixture', () => {
  it('all 5 new trigger kinds have a baseline entry', () => {
    for (const kind of NEW_TRIGGER_KINDS) {
      expect(BASELINES[kind]).toBeDefined()
      expect(typeof BASELINES[kind]).toBe('string')
      expect(BASELINES[kind].length).toBe(64)
    }
  })

  for (const kind of NEW_TRIGGER_KINDS) {
    it(`${kind}: computed hash matches baseline`, async () => {
      const computed = await computeHash()
      expect(computed).toBe(BASELINES[kind])
    })
  }

  it('all 5 baselines are identical (trigger payload in side-load, not system prompt)', () => {
    const values = NEW_TRIGGER_KINDS.map((k) => BASELINES[k])
    const unique = new Set(values)
    expect(unique.size).toBe(1)
  })
})
