import { afterEach, describe, expect, it } from 'bun:test'
import { z } from 'zod'

import {
  __resetDeclarativeRegistryForTests,
  defineDeclarativeResource,
  getDeclarativeResource,
  listDeclarativeResources,
} from './define'

describe('defineDeclarativeResource', () => {
  afterEach(() => __resetDeclarativeRegistryForTests())

  it('registers a resource and returns a typed handle', () => {
    const res = defineDeclarativeResource({
      kind: 'demo_views',
      sourceGlobs: 'modules/*/views/*.view.yaml',
      format: 'yaml',
      bodySchema: z.object({ name: z.string() }),
      serialize: (b) => `name: ${b.name}\n`,
    })
    expect(res.kind).toBe('demo_views')
    expect(res.sourceGlobs).toEqual(['modules/*/views/*.view.yaml'])
    expect(getDeclarativeResource('demo_views')?.kind).toBe('demo_views')
    expect(listDeclarativeResources()).toHaveLength(1)
  })

  it('rejects duplicate kinds', () => {
    defineDeclarativeResource({
      kind: 'k1',
      sourceGlobs: 'x',
      format: 'yaml',
      bodySchema: z.object({}),
      serialize: () => '',
    })
    expect(() =>
      defineDeclarativeResource({
        kind: 'k1',
        sourceGlobs: 'y',
        format: 'yaml',
        bodySchema: z.object({}),
        serialize: () => '',
      }),
    ).toThrow(/already registered/)
  })

  it('rejects non-snake-case kind', () => {
    expect(() =>
      defineDeclarativeResource({
        kind: 'MyResource',
        sourceGlobs: 'x',
        format: 'yaml',
        bodySchema: z.object({}),
        serialize: () => '',
      }),
    ).toThrow(/snake_case/)
  })
})
