import { describe, expect, it } from 'bun:test'

import { defineIndexContributor, IndexFileBuilder } from './index-file-builder'

describe('IndexFileBuilder', () => {
  it('renders contributors in priority order, ascending', () => {
    const builder = new IndexFileBuilder()
      .register(defineIndexContributor({ file: 'AGENTS.md', priority: 100, render: () => '## Body' }))
      .register(defineIndexContributor({ file: 'AGENTS.md', priority: 0, render: () => '# Preamble' }))
      .register(defineIndexContributor({ file: 'AGENTS.md', priority: 999, render: () => '## Footer' }))
    expect(builder.build({ file: 'AGENTS.md' })).toBe('# Preamble\n\n## Body\n\n## Footer')
  })

  it('preserves registration order for equal-priority contributors (stable sort)', () => {
    const builder = new IndexFileBuilder()
      .register(defineIndexContributor({ file: 'INDEX.md', priority: 100, render: () => 'A' }))
      .register(defineIndexContributor({ file: 'INDEX.md', priority: 100, render: () => 'B' }))
      .register(defineIndexContributor({ file: 'INDEX.md', priority: 100, render: () => 'C' }))
    expect(builder.build({ file: 'INDEX.md' })).toBe('A\n\nB\n\nC')
  })

  it('only fires contributors for the requested file', () => {
    const builder = new IndexFileBuilder()
      .register(defineIndexContributor({ file: 'AGENTS.md', priority: 0, render: () => 'agents-only' }))
      .register(defineIndexContributor({ file: 'INDEX.md', priority: 0, render: () => 'index-only' }))
    expect(builder.build({ file: 'AGENTS.md' })).toBe('agents-only')
    expect(builder.build({ file: 'INDEX.md' })).toBe('index-only')
  })

  it('drops null + empty-after-trim sections', () => {
    const builder = new IndexFileBuilder()
      .register(defineIndexContributor({ file: 'AGENTS.md', priority: 0, render: () => 'kept' }))
      .register(defineIndexContributor({ file: 'AGENTS.md', priority: 50, render: () => null }))
      .register(defineIndexContributor({ file: 'AGENTS.md', priority: 100, render: () => '   \n  ' }))
      .register(defineIndexContributor({ file: 'AGENTS.md', priority: 200, render: () => 'after' }))
    expect(builder.build({ file: 'AGENTS.md' })).toBe('kept\n\nafter')
  })

  it('threads `scratch` into contributor context', () => {
    const builder = new IndexFileBuilder().register(
      defineIndexContributor({
        file: 'INDEX.md',
        priority: 0,
        render: (ctx) => `wakeId=${ctx.scratch?.wakeId ?? 'none'}`,
      }),
    )
    expect(builder.build({ file: 'INDEX.md', scratch: { wakeId: 'w-42' } })).toBe('wakeId=w-42')
  })

  it('produces deterministic output across rebuilds with the same registration order', () => {
    const builder = new IndexFileBuilder()
      .register(defineIndexContributor({ file: 'AGENTS.md', priority: 100, render: () => 'mid' }))
      .register(defineIndexContributor({ file: 'AGENTS.md', priority: 50, render: () => 'top' }))
      .register(defineIndexContributor({ file: 'AGENTS.md', priority: 999, render: () => 'tail' }))
    const first = builder.build({ file: 'AGENTS.md' })
    const second = builder.build({ file: 'AGENTS.md' })
    expect(first).toBe(second)
  })
})
