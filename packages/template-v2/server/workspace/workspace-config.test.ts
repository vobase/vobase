import { describe, expect, it } from 'bun:test'
import { defineModule, type ModuleInstance, type ModuleManifest } from '@server/runtime/define-module'
import { buildWorkspaceConfig, pathOverlaps, RUNTIME_OWNED_PATHS } from './workspace-config'

function mk(name: string, manifest: ModuleManifest): ModuleInstance {
  return defineModule({ name, version: '1.0.0', manifest, init: () => undefined })
}

describe('buildWorkspaceConfig', () => {
  it('returns empty owners and frozenEager when no modules have workspace entries', () => {
    const cfg = buildWorkspaceConfig([])
    expect(cfg.owners).toEqual([])
    expect(cfg.frozenEager).toEqual([])
    expect(cfg.runtimeOwned).toBe(RUNTIME_OWNED_PATHS)
  })

  it('collects owners from each module with a workspace entry', () => {
    const a = mk('inbox', {
      provides: {},
      permissions: [],
      workspace: { owns: [{ kind: 'prefix', path: '/workspace/conversation/' }] },
    })
    const b = mk('drive', {
      provides: {},
      permissions: [],
      workspace: { owns: [{ kind: 'prefix', path: '/workspace/drive/' }] },
    })
    const cfg = buildWorkspaceConfig([a, b])
    expect(cfg.owners).toEqual([
      { moduleName: 'inbox', path: { kind: 'prefix', path: '/workspace/conversation/' } },
      { moduleName: 'drive', path: { kind: 'prefix', path: '/workspace/drive/' } },
    ])
  })

  it('merges frozenEager per module, preserving module ownership', () => {
    const inbox = mk('inbox', {
      provides: {},
      permissions: [],
      workspace: {
        owns: [{ kind: 'prefix', path: '/workspace/conversation/' }],
        frozenEager: [
          { kind: 'exact', path: '/workspace/conversation/messages.md' },
          { kind: 'exact', path: '/workspace/conversation/internal-notes.md' },
        ],
      },
    })
    const cfg = buildWorkspaceConfig([inbox])
    expect(cfg.frozenEager).toEqual([
      { moduleName: 'inbox', path: { kind: 'exact', path: '/workspace/conversation/messages.md' } },
      { moduleName: 'inbox', path: { kind: 'exact', path: '/workspace/conversation/internal-notes.md' } },
    ])
  })

  it('skips modules with no workspace entry', () => {
    const bare = mk('bare', { provides: {}, permissions: [] })
    const cfg = buildWorkspaceConfig([bare])
    expect(cfg.owners).toEqual([])
    expect(cfg.frozenEager).toEqual([])
  })

  it('exposes RUNTIME_OWNED_PATHS unchanged', () => {
    const cfg = buildWorkspaceConfig([])
    expect(cfg.runtimeOwned).toContainEqual({ kind: 'exact', path: '/workspace/AGENTS.md' })
    expect(cfg.runtimeOwned).toContainEqual({ kind: 'prefix', path: '/workspace/tmp/' })
    expect(cfg.runtimeOwned).toContainEqual({ kind: 'prefix', path: '/workspace/contact/drive/' })
    expect(cfg.runtimeOwned).toContainEqual({ kind: 'exact', path: '/workspace/contact/profile.md' })
    expect(cfg.runtimeOwned).toContainEqual({ kind: 'exact', path: '/workspace/contact/MEMORY.md' })
    expect(cfg.runtimeOwned).toContainEqual({ kind: 'prefix', path: '/workspace/skills/' })
  })
})

describe('pathOverlaps', () => {
  it('prefix claim matches target under the same prefix', () => {
    expect(
      pathOverlaps(
        { kind: 'prefix', path: '/workspace/drive/' },
        { kind: 'exact', path: '/workspace/drive/BUSINESS.md' },
      ),
    ).toBe(true)
  })

  it('prefix claim matches a nested prefix target', () => {
    expect(
      pathOverlaps(
        { kind: 'prefix', path: '/workspace/conversation/' },
        { kind: 'prefix', path: '/workspace/conversation/nested/' },
      ),
    ).toBe(true)
  })

  it('exact claim matches only equal exact target', () => {
    expect(
      pathOverlaps({ kind: 'exact', path: '/workspace/AGENTS.md' }, { kind: 'exact', path: '/workspace/AGENTS.md' }),
    ).toBe(true)
    expect(
      pathOverlaps({ kind: 'exact', path: '/workspace/AGENTS.md' }, { kind: 'exact', path: '/workspace/OTHER.md' }),
    ).toBe(false)
  })

  it('disjoint prefixes do not overlap', () => {
    expect(
      pathOverlaps({ kind: 'prefix', path: '/workspace/drive/' }, { kind: 'prefix', path: '/workspace/conversation/' }),
    ).toBe(false)
  })

  it('exact claim does not match an unrelated target', () => {
    expect(
      pathOverlaps({ kind: 'exact', path: '/workspace/AGENTS.md' }, { kind: 'prefix', path: '/workspace/drive/' }),
    ).toBe(false)
  })
})

describe('RUNTIME_OWNED_PATHS collision detection', () => {
  it('detects a module claim that overlaps a runtime-owned prefix', () => {
    const tmp = RUNTIME_OWNED_PATHS.find((p) => p.path === '/workspace/tmp/')
    expect(tmp).toBeDefined()
    if (!tmp) return
    expect(pathOverlaps(tmp, { kind: 'prefix', path: '/workspace/tmp/foo/' })).toBe(true)
    expect(pathOverlaps(tmp, { kind: 'exact', path: '/workspace/tmp/scratch.txt' })).toBe(true)
  })

  it('detects a module claim that overlaps a runtime-owned exact path', () => {
    const agentsMd = RUNTIME_OWNED_PATHS.find((p) => p.path === '/workspace/AGENTS.md')
    expect(agentsMd).toBeDefined()
    if (!agentsMd) return
    expect(pathOverlaps(agentsMd, { kind: 'exact', path: '/workspace/AGENTS.md' })).toBe(true)
  })
})
