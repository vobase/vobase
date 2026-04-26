import { describe, expect, it } from 'bun:test'

import { parseFileBytes, serializeMarkdownFrontmatter } from './parse'

describe('parseFileBytes', () => {
  it('parses pure yaml', () => {
    const r = parseFileBytes('yaml', 'name: triage\nfilters:\n  - status: open\n')
    expect(r.body).toEqual({ name: 'triage', filters: [{ status: 'open' }] })
    expect(r.hashableContent).toBe('name: triage\nfilters:\n  - status: open\n')
  })

  it('parses markdown-frontmatter and folds content into body.content', () => {
    const r = parseFileBytes('markdown-frontmatter', '---\nname: hello\ninject: always\n---\n\n# Body\n\nText.')
    expect(r.body).toMatchObject({ name: 'hello', inject: 'always' })
    expect((r.body as { content: string }).content).toBe('# Body\n\nText.')
  })

  it('treats files without frontmatter as pure-body markdown', () => {
    const r = parseFileBytes('markdown-frontmatter', '# Just markdown')
    expect((r.body as { content: string }).content).toBe('# Just markdown')
  })
})

describe('serializeMarkdownFrontmatter', () => {
  it('round-trips frontmatter + content', () => {
    const out = serializeMarkdownFrontmatter({ name: 'demo', content: '# Hi' })
    expect(out).toContain('---')
    expect(out).toContain('name')
    expect(out).toContain('# Hi')
  })
})
