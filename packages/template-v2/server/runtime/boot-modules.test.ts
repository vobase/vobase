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
    ports: {
      inbox: new Proxy({}, { get: (_, p) => throwing(`ports.inbox.${String(p)}`) }) as PluginContext['ports']['inbox'],
      contacts: new Proxy(
        {},
        { get: (_, p) => throwing(`ports.contacts.${String(p)}`) },
      ) as PluginContext['ports']['contacts'],
      drive: new Proxy({}, { get: (_, p) => throwing(`ports.drive.${String(p)}`) }) as PluginContext['ports']['drive'],
      agents: new Proxy(
        {},
        { get: (_, p) => throwing(`ports.agents.${String(p)}`) },
      ) as PluginContext['ports']['agents'],
      caption: new Proxy(
        {},
        { get: (_, p) => throwing(`ports.caption.${String(p)}`) },
      ) as PluginContext['ports']['caption'],
    },
    db: {} as PluginContext['db'],
    jobs: undefined,
    storage: {},
    realtime: { notify: () => undefined },
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
})
