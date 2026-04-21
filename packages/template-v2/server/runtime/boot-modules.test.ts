import { describe, expect, it } from 'bun:test'
import type { PluginContext } from '@server/contracts/plugin-context'
import { Hono, type MiddlewareHandler } from 'hono'
import { bootModules } from './boot-modules'
import { defineModule, type ModuleManifest } from './define-module'

const manifest: ModuleManifest = { provides: {}, permissions: [] }

function fakeCtxInput() {
  const throwing = (field: string) => () => {
    throw new Error(`unexpected access to ${field} in test`)
  }
  return {
    caption: new Proxy(
      {},
      { get: (_, p) => throwing(`caption.${String(p)}`) },
    ) as PluginContext['caption'],
    db: {} as PluginContext['db'],
    jobs: {
      async send() {
        return 'job-test'
      },
      async cancel() {},
    },
    storage: {
      getBucket() {
        throw new Error('ScopedStorage not configured in this test')
      },
    },
    realtime: { notify: () => undefined, subscribe: () => () => {} },
    logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
    metrics: { increment: () => undefined, gauge: () => undefined, timing: () => undefined },
  } satisfies Parameters<typeof bootModules>[0]['ctx']
}

const noopSession: MiddlewareHandler = async (_c, next) => {
  await next()
}

describe('bootModules', () => {
  it('calls init in dependency order', async () => {
    const calls: string[] = []
    const a = defineModule({ name: 'a', version: '1.0', manifest, init: () => void calls.push('a') })
    const b = defineModule({
      name: 'b',
      version: '1.0',
      requires: ['a'],
      manifest,
      init: () => void calls.push('b'),
    })
    const c = defineModule({
      name: 'c',
      version: '1.0',
      requires: ['b'],
      manifest,
      init: () => void calls.push('c'),
    })
    // Pass in reverse order — sort should still produce a,b,c.
    await bootModules({ modules: [c, b, a], app: new Hono(), ctx: fakeCtxInput(), requireSession: noopSession })
    expect(calls).toEqual(['a', 'b', 'c'])
  })

  it('skips modules whose enabled predicate returns false — no init, no route', async () => {
    const calls: string[] = []
    const handler = new Hono()
    handler.get('/hi', (c) => c.text('skipped'))
    const skipped = defineModule({
      name: 'skipped',
      version: '1.0',
      manifest,
      enabled: () => false,
      routes: { basePath: '/api/skipped', handler },
      init: () => void calls.push('skipped'),
    })
    const app = new Hono()
    await bootModules({ modules: [skipped], app, ctx: fakeCtxInput(), requireSession: noopSession })
    expect(calls).toEqual([])
    const res = await app.request('/api/skipped/hi')
    expect(res.status).toBe(404)
  })

  it('mounts routes and applies session gate only when requireSession=true', async () => {
    const openHandler = new Hono()
    openHandler.get('/ping', (c) => c.text('open-ok'))
    const guardedHandler = new Hono()
    guardedHandler.get('/ping', (c) => c.text('guarded-ok'))

    const open = defineModule({
      name: 'open',
      version: '1.0',
      manifest,
      routes: { basePath: '/api/open', handler: openHandler },
      init: () => undefined,
    })
    const guarded = defineModule({
      name: 'guarded',
      version: '1.0',
      manifest,
      routes: { basePath: '/api/guarded', handler: guardedHandler, requireSession: true },
      init: () => undefined,
    })

    const app = new Hono()
    const denyAll: MiddlewareHandler = async (c) => c.json({ error: 'unauthenticated' }, 401)
    await bootModules({ modules: [open, guarded], app, ctx: fakeCtxInput(), requireSession: denyAll })

    expect((await app.request('/api/open/ping')).status).toBe(200)
    expect((await app.request('/api/guarded/ping')).status).toBe(401)
  })

  it('aggregates registrations from every initialized module', async () => {
    const tool = { name: 't1', description: '', inputSchema: {}, execute: async () => ({ ok: true }) }
    const observer = { id: 'o1', handle: async () => undefined }
    const m1 = defineModule({
      name: 'm1',
      version: '1.0',
      manifest,
      init: (ctx) => {
        ctx.registerTool(tool as never)
      },
    })
    const m2 = defineModule({
      name: 'm2',
      version: '1.0',
      manifest,
      init: (ctx) => {
        ctx.registerObserver(observer as never)
      },
    })
    const regs = await bootModules({
      modules: [m1, m2],
      app: new Hono(),
      ctx: fakeCtxInput(),
      requireSession: noopSession,
    })
    expect(regs.tools.map((t) => t.name)).toEqual(['t1'])
    expect(regs.observers.map((o) => o.id)).toEqual(['o1'])
  })

  it('throws ManifestCollisionError when two modules claim overlapping workspace prefixes', async () => {
    const a = defineModule({
      name: 'a',
      version: '1.0',
      manifest: {
        provides: {},
        permissions: [],
        workspace: { owns: [{ kind: 'prefix', path: '/workspace/foo/' }] },
      },
      init: () => undefined,
    })
    const b = defineModule({
      name: 'b',
      version: '1.0',
      manifest: {
        provides: {},
        permissions: [],
        workspace: { owns: [{ kind: 'exact', path: '/workspace/foo/bar.md' }] },
      },
      init: () => undefined,
    })
    await expect(
      bootModules({ modules: [a, b], app: new Hono(), ctx: fakeCtxInput(), requireSession: noopSession }),
    ).rejects.toThrow(/collision/i)
  })

  it('throws NamespaceViolationError when a module claims a runtime-owned path', async () => {
    const rogue = defineModule({
      name: 'rogue',
      version: '1.0',
      manifest: {
        provides: {},
        permissions: [],
        workspace: { owns: [{ kind: 'exact', path: '/workspace/AGENTS.md' }] },
      },
      init: () => undefined,
    })
    await expect(
      bootModules({ modules: [rogue], app: new Hono(), ctx: fakeCtxInput(), requireSession: noopSession }),
    ).rejects.toThrow(/namespace violation/i)
  })

  it('throws ManifestMismatchError when registered observer id is not declared in manifest.provides.observers', async () => {
    const mod = defineModule({
      name: 'x',
      version: '1.0',
      manifest: { provides: { observers: ['x:declared'] }, permissions: [] },
      init: (ctx) => {
        ctx.registerObserver({ id: 'x:undeclared', handle: async () => undefined } as never)
      },
    })
    await expect(
      bootModules({ modules: [mod], app: new Hono(), ctx: fakeCtxInput(), requireSession: noopSession }),
    ).rejects.toThrow(/manifest mismatch/i)
  })

  it('skips manifest.provides.observers id check when declarations are absent (opt-in)', async () => {
    const mod = defineModule({
      name: 'x',
      version: '1.0',
      manifest: { provides: {}, permissions: [] },
      init: (ctx) => {
        ctx.registerObserver({ id: 'anything', handle: async () => undefined } as never)
      },
    })
    await expect(
      bootModules({ modules: [mod], app: new Hono(), ctx: fakeCtxInput(), requireSession: noopSession }),
    ).resolves.toBeDefined()
  })
})
