import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'

import type { AgentTool, SideLoadContributor, WorkspaceMaterializerFactory } from '../harness/types'
import type { JobDef } from '../scheduler/types'
import { defineIndexContributor } from '../workspace/index-file-builder'
import { collectAgentContributions, collectJobs, collectWebRoutes } from './collect'
import { InvalidModuleError, type ModuleDef, type RoHintFn } from './module-def'

type M = ModuleDef<unknown, unknown>

const stubInit: M['init'] = () => {}

function mkTool(name: string): AgentTool {
  return {
    name,
    description: name,
    inputSchema: { type: 'object' as const },
    // biome-ignore lint/suspicious/useAwait: AgentTool execute contract requires async signature
    async execute() {
      return { ok: true, content: name }
    },
  }
}

function mkMaterializerFactory(path: string): WorkspaceMaterializerFactory {
  return () => [{ path, phase: 'side-load', materialize: async () => '' }]
}

const mkSideLoad: () => SideLoadContributor = () => async () => []

describe('collectAgentContributions', () => {
  it('iterates modules in sort order and preserves array order within each', () => {
    const a: M = {
      name: 'a',
      init: stubInit,
      agent: { tools: [mkTool('a.1'), mkTool('a.2')] },
    }
    const b: M = {
      name: 'b',
      requires: ['a'],
      init: stubInit,
      agent: { tools: [mkTool('b.1')] },
    }
    const reverseInput: M[] = [b, a]
    const result = collectAgentContributions(reverseInput)
    expect(result.tools.map((t) => t.name)).toEqual(['a.1', 'a.2', 'b.1'])
  })

  it('merges listener slots by concat across modules', () => {
    const l1 = () => {}
    const l2 = () => {}
    const l3 = () => {}
    const a: M = {
      name: 'a',
      init: stubInit,
      agent: { listeners: { on_event: [l1, l2] } },
    }
    const b: M = {
      name: 'b',
      requires: ['a'],
      init: stubInit,
      agent: { listeners: { on_event: [l3] } },
    }
    const result = collectAgentContributions([a, b])
    expect(result.listeners.on_event).toEqual([l1, l2, l3])
  })

  it('returns empty bundles when no module declares an agent surface', () => {
    const a: M = { name: 'a', init: stubInit }
    const result = collectAgentContributions([a])
    expect(result.tools).toEqual([])
    expect(result.materializers).toEqual([])
    expect(result.sideLoad).toEqual([])
    expect(result.listeners).toEqual({})
  })

  it('collects materializer factories and side-load contributors', () => {
    const a: M = {
      name: 'a',
      init: stubInit,
      agent: {
        materializers: [mkMaterializerFactory('/a.md')],
        sideLoad: [mkSideLoad()],
      },
    }
    const result = collectAgentContributions([a])
    expect(result.materializers).toHaveLength(1)
    expect(result.materializers[0]({})).toEqual([
      { path: '/a.md', phase: 'side-load', materialize: expect.any(Function) },
    ])
    expect(result.sideLoad).toHaveLength(1)
  })

  it('aggregates agentsMd contributors across modules in dependency order', () => {
    const aSelf = defineIndexContributor({
      file: 'AGENTS.md',
      priority: 20,
      name: 'a.self',
      render: () => '## Self',
    })
    const bSurface = defineIndexContributor({
      file: 'AGENTS.md',
      priority: 50,
      name: 'b.surface',
      render: () => '## Surface',
    })
    const cIndex = defineIndexContributor({
      file: 'INDEX.md',
      priority: 10,
      name: 'c.index',
      render: () => '## Index',
    })
    const a: M = { name: 'a', init: stubInit, agent: { agentsMd: [aSelf] } }
    const b: M = { name: 'b', requires: ['a'], init: stubInit, agent: { agentsMd: [bSurface, cIndex] } }
    const result = collectAgentContributions([b, a])
    expect(result.agentsMd.map((c) => c.name)).toEqual(['a.self', 'b.surface', 'c.index'])
  })

  it('chains roHints across modules in dependency order', () => {
    const aHint: RoHintFn = (path) => (path.endsWith('/a.md') ? 'a-hint' : null)
    const bHint: RoHintFn = (path) => (path.endsWith('/b.md') ? 'b-hint' : null)
    const a: M = { name: 'a', init: stubInit, agent: { roHints: [aHint] } }
    const b: M = { name: 'b', requires: ['a'], init: stubInit, agent: { roHints: [bHint] } }
    const result = collectAgentContributions([b, a])
    expect(result.roHints).toHaveLength(2)
    expect(result.roHints[0]('/x/a.md')).toBe('a-hint')
    expect(result.roHints[0]('/x/b.md')).toBeNull()
    expect(result.roHints[1]('/x/b.md')).toBe('b-hint')
  })

  it('preserves sideLoad declaration order across modules', () => {
    const s1 = mkSideLoad()
    const s2 = mkSideLoad()
    const s3 = mkSideLoad()
    const a: M = { name: 'a', init: stubInit, agent: { sideLoad: [s1, s2] } }
    const b: M = { name: 'b', requires: ['a'], init: stubInit, agent: { sideLoad: [s3] } }
    const result = collectAgentContributions([b, a])
    expect(result.sideLoad).toEqual([s1, s2, s3])
  })

  it('flattens factories so identical paths from different modules co-exist', () => {
    // Two modules both contributing materializers for the same path is the
    // expected pattern when one module renders an "owner" view and another
    // renders an "augmentation" — collector keeps both, last-write-wins is the
    // workspace's job.
    const a: M = {
      name: 'a',
      init: stubInit,
      agent: { materializers: [mkMaterializerFactory('/shared.md')] },
    }
    const b: M = {
      name: 'b',
      requires: ['a'],
      init: stubInit,
      agent: { materializers: [mkMaterializerFactory('/shared.md')] },
    }
    const result = collectAgentContributions([a, b])
    expect(result.materializers).toHaveLength(2)
  })

  it('skips listener slots that are absent on a module', () => {
    const a: M = {
      name: 'a',
      init: stubInit,
      agent: { listeners: { on_event: [() => {}] } },
    }
    const b: M = {
      name: 'b',
      requires: ['a'],
      init: stubInit,
      agent: { listeners: { on_tool_call: [() => {}] } },
    }
    const result = collectAgentContributions([a, b])
    expect(result.listeners.on_event).toHaveLength(1)
    expect(result.listeners.on_tool_call).toHaveLength(1)
    expect(result.listeners.on_tool_result).toBeUndefined()
  })

  it('threads TCtx through factories — the same context object reaches every factory', () => {
    type Ctx = { tag: string }
    const seen: string[] = []
    const fA: WorkspaceMaterializerFactory<Ctx> = (ctx) => {
      seen.push(`a:${ctx.tag}`)
      return []
    }
    const fB: WorkspaceMaterializerFactory<Ctx> = (ctx) => {
      seen.push(`b:${ctx.tag}`)
      return []
    }
    type MCtx = ModuleDef<unknown, unknown, Ctx>
    const a: MCtx = { name: 'a', init: stubInit, agent: { materializers: [fA] } }
    const b: MCtx = { name: 'b', requires: ['a'], init: stubInit, agent: { materializers: [fB] } }
    const result = collectAgentContributions<unknown, unknown, Ctx>([a, b])
    for (const f of result.materializers) f({ tag: 'wake-1' })
    expect(seen).toEqual(['a:wake-1', 'b:wake-1'])
  })
})

describe('collectWebRoutes', () => {
  it('emits routes from m.web.routes in dependency order', () => {
    const a: M = {
      name: 'a',
      init: stubInit,
      web: { routes: { basePath: '/api/a', handler: new Hono() } },
    }
    const b: M = {
      name: 'b',
      requires: ['a'],
      init: stubInit,
      web: { routes: { basePath: '/api/b', handler: new Hono(), requireSession: true } },
    }
    const result = collectWebRoutes([b, a])
    expect(result.map((r) => r.basePath)).toEqual(['/api/a', '/api/b'])
    expect(result[1].requireSession).toBe(true)
  })

  it('carries middlewares from m.web', () => {
    const mw = () => Promise.resolve()
    const a: M = {
      name: 'a',
      init: stubInit,
      web: {
        routes: { basePath: '/api/a', handler: new Hono() },
        middlewares: [mw],
      },
    }
    const result = collectWebRoutes([a])
    expect(result[0].middlewares).toEqual([mw])
  })

  it('skips modules with no web.routes declared', () => {
    const a: M = { name: 'a', init: stubInit }
    expect(collectWebRoutes([a])).toEqual([])
  })
})

describe('collectJobs', () => {
  const jobHandler = async () => {}

  it('flattens jobs in module sort order', () => {
    const a: M = {
      name: 'a',
      init: stubInit,
      jobs: [{ name: 'a:one', handler: jobHandler }],
    }
    const b: M = {
      name: 'b',
      requires: ['a'],
      init: stubInit,
      jobs: [{ name: 'b:one', handler: jobHandler }],
    }
    const result = collectJobs([b, a])
    expect(result.map((j) => j.name)).toEqual(['a:one', 'b:one'])
  })

  it('skips entries marked disabled', () => {
    const a: M = {
      name: 'a',
      init: stubInit,
      jobs: [
        { name: 'a:off', handler: jobHandler, disabled: true },
        { name: 'a:on', handler: jobHandler },
      ],
    }
    const result = collectJobs([a])
    expect(result.map((j) => j.name)).toEqual(['a:on'])
  })

  it('throws InvalidModuleError on duplicate job name across modules', () => {
    const a: M = {
      name: 'a',
      init: stubInit,
      jobs: [{ name: 'shared', handler: jobHandler }],
    }
    const b: M = {
      name: 'b',
      requires: ['a'],
      init: stubInit,
      jobs: [{ name: 'shared', handler: jobHandler }],
    }
    expect(() => collectJobs([a, b])).toThrow(InvalidModuleError)
  })

  it('does not flag a disabled duplicate against a later enabled entry', () => {
    const a: M = {
      name: 'a',
      init: stubInit,
      jobs: [{ name: 'shared', handler: jobHandler, disabled: true }],
    }
    const b: M = {
      name: 'b',
      requires: ['a'],
      init: stubInit,
      jobs: [{ name: 'shared', handler: jobHandler }],
    }
    const result: JobDef[] = collectJobs([a, b])
    expect(result.map((j) => j.name)).toEqual(['shared'])
  })
})
