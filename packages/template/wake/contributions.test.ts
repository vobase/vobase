/**
 * Contract test for the cross-module contribution pipeline.
 *
 * `collectAgentContributions` flattens every registered module's
 * `agent.{tools, listeners, materializers, sideLoad, agentsMd, roHints}` into
 * a single `AgentContributions<WakeContext>` bundle. This test exercises the
 * collector against the real template module list to guarantee:
 *   - Every module that ships a `materializers` slot is reachable.
 *   - The `agentsMd` slot aggregates contributors from each owning module.
 *   - The `roHints` chain has every module's hint represented.
 *   - The collector preserves dependency-sort order.
 *
 * Pure synthesis — does NOT boot the harness, mount a workspace, or hit a DB.
 */

import { describe, expect, it } from 'bun:test'
import { setCliRegistry } from '@modules/agents/service/cli-registry'
import { CliVerbRegistry, collectAgentContributions } from '@vobase/core'

import { modules as ALL_MODULES } from '~/runtime/modules'
import type { WakeContext } from './context'

// agentsMaterializerFactory calls getCliRegistry() in its body — install an
// empty registry so the contract test can invoke each factory without booting
// the agents module's full init.
setCliRegistry(new CliVerbRegistry())

describe('collectAgentContributions over the real template module list', () => {
  it('returns a non-empty materializer factory list', () => {
    const result = collectAgentContributions<unknown, unknown, WakeContext>(ALL_MODULES)
    expect(result.materializers.length).toBeGreaterThanOrEqual(5)
  })

  it('aggregates AGENTS.md contributors from every contributing module', () => {
    const result = collectAgentContributions<unknown, unknown, WakeContext>(ALL_MODULES)
    const names = result.agentsMd.map((c) => c.name)
    expect(names).toContain('agents.self-state')
    expect(names).toContain('drive.organization-knowledge')
    expect(names).toContain('contacts.contact-context')
    expect(names).toContain('messaging.conversation-surface')
    expect(names).toContain('team.staff-roster')
  })

  it('returns roHints from every module that ships them', () => {
    const result = collectAgentContributions<unknown, unknown, WakeContext>(ALL_MODULES)
    // 4 modules ship hints — agents/contacts/drive/messaging. team does not.
    expect(result.roHints.length).toBeGreaterThanOrEqual(4)
    // Each hint accepts a path and returns string|null.
    for (const fn of result.roHints) {
      const out = fn('/some/path.md')
      expect(out === null || typeof out === 'string').toBe(true)
    }
  })

  it('emits agents AGENTS.md contributor AFTER its requires (dependency-sort)', () => {
    // The collector calls `sortModules` first. Both ALL_MODULES and a reversed
    // input must yield agents AFTER its dependencies (contacts, drive,
    // messaging, changes).
    const reversed = [...ALL_MODULES].reverse()
    const result = collectAgentContributions<unknown, unknown, WakeContext>(reversed)
    const names = result.agentsMd.map((c) => c.name)
    const agentsIdx = names.indexOf('agents.self-state')
    const driveIdx = names.indexOf('drive.organization-knowledge')
    const contactsIdx = names.indexOf('contacts.contact-context')
    const messagingIdx = names.indexOf('messaging.conversation-surface')
    expect(agentsIdx).toBeGreaterThan(-1)
    expect(driveIdx).toBeGreaterThan(-1)
    expect(contactsIdx).toBeGreaterThan(-1)
    expect(messagingIdx).toBeGreaterThan(-1)
    expect(agentsIdx).toBeGreaterThan(driveIdx)
    expect(agentsIdx).toBeGreaterThan(contactsIdx)
    expect(agentsIdx).toBeGreaterThan(messagingIdx)
  })

  it('listeners bundle has the empty-slot shape when no module ships listeners', () => {
    const result = collectAgentContributions<unknown, unknown, WakeContext>(ALL_MODULES)
    expect(typeof result.listeners).toBe('object')
  })

  it('every materializer factory accepts a WakeContext and returns an array', () => {
    const result = collectAgentContributions<unknown, unknown, WakeContext>(ALL_MODULES)
    // Synthesize a minimal standalone-lane WakeContext — factories should
    // self-gate and return arrays without throwing, even when contactId is
    // undefined.
    const ctx = {
      organizationId: 't1',
      agentId: 'agent-x',
      conversationId: 'conv-x',
      drive: {
        // biome-ignore lint/suspicious/useAwait: stub
        async get() {
          return null
        },
        // biome-ignore lint/suspicious/useAwait: stub
        async getByPath() {
          return null
        },
        // biome-ignore lint/suspicious/useAwait: stub
        async listFolder() {
          return []
        },
        // biome-ignore lint/suspicious/useAwait: stub
        async readContent() {
          return { content: '' }
        },
        // biome-ignore lint/suspicious/useAwait: stub
        async readPath() {
          return null
        },
        // biome-ignore lint/suspicious/useAwait: stub
        async getBusinessMd() {
          return ''
        },
      },
      staffIds: [],
      // biome-ignore lint/suspicious/useAwait: stub
      authLookup: {
        async getAuthDisplay() {
          return null
        },
      },
      agentDefinition: { id: 'agent-x', name: 'x', instructions: '', workingMemory: '' },
      tools: [],
      agentsMdContributors: [],
    } as unknown as WakeContext
    for (const f of result.materializers) {
      const out = f(ctx)
      expect(Array.isArray(out)).toBe(true)
    }
  })
})
