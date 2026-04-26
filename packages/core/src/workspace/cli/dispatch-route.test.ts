import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { z } from 'zod'

import { defineCliVerb } from './define'
import { createCliDispatchRoute } from './dispatch-route'
import { CliVerbRegistry } from './registry'
import type { VerbContext } from './transport'

const ctx: VerbContext = {
  organizationId: 'org_test',
  principal: { kind: 'user', id: 'usr_test' },
  role: 'developer',
}

function makeRegistry(): CliVerbRegistry {
  const r = new CliVerbRegistry()
  r.register(
    defineCliVerb({
      name: 'contacts list',
      description: 'List contacts',
      input: z.object({ limit: z.number().default(10) }),
      body: async ({ input }) => ({
        ok: true as const,
        data: [{ id: 'c1' }, { id: 'c2' }].slice(0, input.limit),
      }),
    }),
  )
  r.register(
    defineCliVerb({
      name: 'admin nuke',
      description: 'Admin only',
      input: z.object({}),
      body: async () => ({ ok: true as const, data: 'ok' }),
      rolesAllowed: ['admin'],
    }),
  )
  return r
}

function mountAt(prefix: string, registry: CliVerbRegistry): Hono {
  const app = new Hono()
  app.route(
    prefix,
    createCliDispatchRoute({
      registry,
      resolveContext: () => ctx,
    }),
  )
  return app
}

describe('createCliDispatchRoute', () => {
  it('dispatches a registered verb and returns its result', async () => {
    const app = mountAt('/api/cli', makeRegistry())
    const res = await app.request('/api/cli/contacts/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 1 }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, data: [{ id: 'c1' }] })
  })

  it('returns 404 unknown_verb when no verb matches the path', async () => {
    const app = mountAt('/api/cli', makeRegistry())
    const res = await app.request('/api/cli/nope', { method: 'POST', body: '{}' })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { errorCode: string }
    expect(body.errorCode).toBe('unknown_verb')
  })

  it('returns 400 invalid_input on schema mismatch', async () => {
    const app = mountAt('/api/cli', makeRegistry())
    const res = await app.request('/api/cli/contacts/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 'not-a-number' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { errorCode: string }
    expect(body.errorCode).toBe('invalid_input')
  })

  it('returns 403 forbidden when the resolved role is not allowed', async () => {
    const registry = makeRegistry()
    const app = new Hono()
    app.route(
      '/api/cli',
      createCliDispatchRoute({
        registry,
        resolveContext: () => ({ ...ctx, role: 'developer' }),
      }),
    )
    const res = await app.request('/api/cli/admin/nuke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(403)
  })

  it('records a VerbEvent on dispatch when recordEvent is supplied', async () => {
    const events: { verb: string; ok: boolean }[] = []
    const registry = makeRegistry()
    const app = new Hono()
    app.route(
      '/api/cli',
      createCliDispatchRoute({
        registry,
        resolveContext: () => ctx,
        recordEvent: (e) => events.push(e),
      }),
    )
    await app.request('/api/cli/contacts/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 2 }),
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ verb: 'contacts list', ok: true })
  })
})
