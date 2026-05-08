import { describe, expect, it } from 'bun:test'

import type { WorkspaceMaterializer } from '../harness/types'
import { MaterializerRegistry } from './materializer-registry'

function mat(path: string): WorkspaceMaterializer {
  return { path, phase: 'frozen', materialize: () => `body-of-${path}` }
}

describe('MaterializerRegistry', () => {
  it('collects frozen materializers', () => {
    const r = new MaterializerRegistry([mat('/agents/a_test/a.md'), mat('/agents/a_test/b.md')])
    expect(r.getFrozen()).toHaveLength(2)
    expect(r.size()).toBe(2)
  })

  it('add() accepts a new materializer at runtime', () => {
    const r = new MaterializerRegistry([])
    r.add(mat('/agents/a_test/z.md'))
    expect(r.size()).toBe(1)
    expect(r.getFrozen()[0]?.path).toBe('/agents/a_test/z.md')
  })
})
