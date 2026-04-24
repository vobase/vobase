import { describe, expect, it } from 'bun:test'

import type { WorkspaceMaterializer } from '../harness/types'
import { MaterializerRegistry } from './materializer-registry'

function mat(path: string, phase: WorkspaceMaterializer['phase']): WorkspaceMaterializer {
  return { path, phase, materialize: () => `body-of-${path}` }
}

describe('MaterializerRegistry', () => {
  it('groups by phase', () => {
    const r = new MaterializerRegistry([
      mat('/agents/a_test/a.md', 'frozen'),
      mat('/agents/a_test/b.md', 'side-load'),
      mat('/agents/a_test/c.md', 'on-read'),
      mat('/agents/a_test/d.md', 'frozen'),
    ])
    expect(r.getFrozen()).toHaveLength(2)
    expect(r.getSideLoad()).toHaveLength(1)
    expect(r.getOnRead()).toHaveLength(1)
    expect(r.size()).toBe(4)
  })

  it('add() accepts a new materializer at runtime', () => {
    const r = new MaterializerRegistry([])
    r.add(mat('/agents/a_test/z.md', 'on-read'))
    expect(r.size()).toBe(1)
    expect(r.getOnRead()[0]?.path).toBe('/agents/a_test/z.md')
  })
})
