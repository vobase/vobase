import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { defineCliVerb } from './define'
import { createInProcessTransport } from './in-process-transport'
import { CliVerbRegistry } from './registry'
import type { VerbContext, VerbEvent } from './transport'

const ctx: VerbContext = {
  organizationId: 'org_test',
  principal: { kind: 'user', id: 'usr_test' },
  role: 'developer',
}

function makeListContacts() {
  return defineCliVerb({
    name: 'contacts list',
    description: 'List contacts',
    input: z.object({ limit: z.number().default(10) }),
    body: async ({ input }) => ({ ok: true as const, data: [{ id: 'c1' }, { id: 'c2' }].slice(0, input.limit) }),
    formatHint: 'table:cols=id',
  })
}

describe('CliVerbRegistry', () => {
  it('registers a verb and exposes it via list/get', () => {
    const r = new CliVerbRegistry()
    r.register(makeListContacts())
    expect(r.size()).toBe(1)
    expect(r.get('contacts list')?.description).toBe('List contacts')
    expect(r.list().map((v) => v.name)).toEqual(['contacts list'])
  })

  it('throws on duplicate registration', () => {
    const r = new CliVerbRegistry()
    r.register(makeListContacts())
    expect(() => r.register(makeListContacts())).toThrow(/duplicate verb/)
  })

  it('produces a deterministic catalog with stable etag', () => {
    const r1 = new CliVerbRegistry()
    const r2 = new CliVerbRegistry()
    r1.register(makeListContacts())
    r2.register(makeListContacts())
    const c1 = r1.catalog()
    const c2 = r2.catalog()
    expect(c1.etag).toBe(c2.etag)
    expect(c1.verbs).toHaveLength(1)
    expect(c1.verbs[0].name).toBe('contacts list')
    expect(c1.verbs[0].route).toBe('/api/cli/contacts/list')
    expect(c1.verbs[0].formatHint).toBe('table:cols=id')
  })

  it('etag changes when verbs are added', () => {
    const r = new CliVerbRegistry()
    r.register(makeListContacts())
    const before = r.catalog().etag
    r.register(
      defineCliVerb({
        name: 'contacts show',
        description: 'Show one',
        input: z.object({ id: z.string() }),
        body: async () => ({ ok: true as const, data: { id: 'c1' } }),
      }),
    )
    expect(r.catalog().etag).not.toBe(before)
  })

  it('memoizes catalog across calls and returns the same reference', () => {
    const r = new CliVerbRegistry()
    r.register(makeListContacts())
    const a = r.catalog()
    const b = r.catalog()
    expect(a).toBe(b)
  })

  it('invalidates the memoized catalog when a verb is registered', () => {
    const r = new CliVerbRegistry()
    r.register(makeListContacts())
    const before = r.catalog()
    r.register(
      defineCliVerb({
        name: 'contacts show',
        description: 'Show',
        input: z.object({ id: z.string() }),
        body: async () => ({ ok: true as const, data: null }),
      }),
    )
    const after = r.catalog()
    expect(after).not.toBe(before)
    expect(after.verbs).toHaveLength(2)
  })

  it('dispatches a verb through the in-process transport', async () => {
    const r = new CliVerbRegistry()
    r.register(makeListContacts())
    const events: VerbEvent[] = []
    const transport = createInProcessTransport({ context: ctx, recordEvent: (e) => events.push(e) })
    const result = await r.dispatch('contacts list', { limit: 1 }, transport)
    expect(result).toEqual({ ok: true, data: [{ id: 'c1' }] })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ verb: 'contacts list', transport: 'in-process', ok: true })
  })

  it('returns invalid_input on schema mismatch', async () => {
    const r = new CliVerbRegistry()
    r.register(makeListContacts())
    const transport = createInProcessTransport({ context: ctx })
    const result = await r.dispatch('contacts list', { limit: 'not-a-number' }, transport)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('invalid_input')
  })

  it('returns unknown_verb when name is missing', async () => {
    const r = new CliVerbRegistry()
    const transport = createInProcessTransport({ context: ctx })
    const result = await r.dispatch('does not exist', {}, transport)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('unknown_verb')
  })

  it('enforces rolesAllowed', async () => {
    const r = new CliVerbRegistry()
    r.register(
      defineCliVerb({
        name: 'admin nuke',
        description: 'Admin only',
        input: z.object({}),
        body: async () => ({ ok: true as const, data: 'ok' }),
        rolesAllowed: ['admin'],
      }),
    )
    const transport = createInProcessTransport({ context: { ...ctx, role: 'developer' } })
    const result = await r.dispatch('admin nuke', {}, transport)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('forbidden')
  })

  it('catches thrown errors and reports internal_error', async () => {
    const r = new CliVerbRegistry()
    r.register(
      defineCliVerb({
        name: 'will throw',
        description: 'boom',
        input: z.object({}),
        body: () => {
          throw new Error('boom')
        },
      }),
    )
    const transport = createInProcessTransport({ context: ctx })
    const result = await r.dispatch('will throw', {}, transport)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorCode).toBe('internal_error')
      expect(result.error).toBe('boom')
    }
  })
})

describe('CliVerbRegistry.catalogFor', () => {
  function makeVerbAudience(name: string, audience: 'contact' | 'staff' | 'admin') {
    return defineCliVerb({
      name,
      description: `${audience} verb`,
      input: z.object({}),
      body: async () => ({ ok: true as const, data: null }),
      audience,
    })
  }

  function makeMultiTierRegistry() {
    const r = new CliVerbRegistry()
    r.register(makeVerbAudience('verb contact', 'contact'))
    r.register(makeVerbAudience('verb staff', 'staff'))
    r.register(makeVerbAudience('verb admin', 'admin'))
    return r
  }

  it('catalogFor contact returns only contact-audience verbs', () => {
    const r = makeMultiTierRegistry()
    const c = r.catalogFor('contact')
    expect(c.verbs.map((v) => v.name)).toEqual(['verb contact'])
  })

  it('catalogFor staff returns contact and staff verbs', () => {
    const r = makeMultiTierRegistry()
    const c = r.catalogFor('staff')
    expect(c.verbs.map((v) => v.name)).toEqual(['verb contact', 'verb staff'])
  })

  it('catalogFor admin returns all verbs (untagged default is admin)', () => {
    const r = makeMultiTierRegistry()
    // Also add an untagged verb — its default audience is 'admin'.
    r.register(
      defineCliVerb({
        name: 'verb untagged',
        description: 'no audience tag',
        input: z.object({}),
        body: async () => ({ ok: true as const, data: null }),
      }),
    )
    const c = r.catalogFor('admin')
    expect(c.verbs.map((v) => v.name)).toEqual(['verb admin', 'verb contact', 'verb staff', 'verb untagged'])
  })

  it('two consecutive catalogFor calls for the same tier return identical etags (memoisation)', () => {
    const r = makeMultiTierRegistry()
    const first = r.catalogFor('staff')
    const second = r.catalogFor('staff')
    expect(first.etag).toBe(second.etag)
    expect(first).toBe(second)
  })

  it('cache is invalidated after register — new catalogFor produces a fresh etag', () => {
    const r = makeMultiTierRegistry()
    const before = r.catalogFor('staff')
    r.register(makeVerbAudience('verb staff 2', 'staff'))
    const after = r.catalogFor('staff')
    expect(after.etag).not.toBe(before.etag)
    expect(after.verbs.map((v) => v.name)).toContain('verb staff 2')
  })
})

describe('defineCliVerb', () => {
  it('rejects empty names', () => {
    expect(() =>
      defineCliVerb({
        name: '   ',
        description: 'bad',
        input: z.object({}),
        body: async () => ({ ok: true as const, data: null }),
      }),
    ).toThrow(/non-empty/)
  })

  it('derives a default route from the verb name', () => {
    const v = defineCliVerb({
      name: 'drive ls',
      description: 'List drive',
      input: z.object({}),
      body: async () => ({ ok: true as const, data: [] }),
    })
    expect(v.route).toBe('/api/cli/drive/ls')
  })

  it('respects an explicit route override', () => {
    const v = defineCliVerb({
      name: 'memory show',
      description: 'show',
      input: z.object({}),
      body: async () => ({ ok: true as const, data: '' }),
      route: '/custom/memory',
    })
    expect(v.route).toBe('/custom/memory')
  })
})
