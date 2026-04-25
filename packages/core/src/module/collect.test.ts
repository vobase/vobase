import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'

import type { AgentTool, CommandDef, SideLoadContributor, WorkspaceMaterializer } from '../harness/types'
import type { JobDef } from '../scheduler/types'
import { collectAgentContributions, collectJobs, collectWebRoutes } from './collect'
import { InvalidModuleError, type ModuleDef } from './module-def'

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

function mkMaterializer(path: string): WorkspaceMaterializer {
  return { path, phase: 'side-load', materialize: async () => '' }
}

function mkCommand(name: string): CommandDef {
  return { name, description: name, execute: async () => ({ ok: true, content: '' }) }
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
    expect(result.commands).toEqual([])
    expect(result.sideLoad).toEqual([])
    expect(result.listeners).toEqual({})
  })

  it('collects materializers, commands, and side-load contributors', () => {
    const a: M = {
      name: 'a',
      init: stubInit,
      agent: {
        materializers: [mkMaterializer('/a.md')],
        commands: [mkCommand('a-cmd')],
        sideLoad: [mkSideLoad()],
      },
    }
    const result = collectAgentContributions([a])
    expect(result.materializers).toHaveLength(1)
    expect(result.commands.map((c) => c.name)).toEqual(['a-cmd'])
    expect(result.sideLoad).toHaveLength(1)
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
