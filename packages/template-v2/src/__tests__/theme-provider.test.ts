import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('dark default (Axis B)', () => {
  it('index.html has class="dark" on <html> element', () => {
    const html = readFileSync(join(import.meta.dir, '../../index.html'), 'utf8')
    expect(html).toMatch(/<html[^>]*class="[^"]*dark[^"]*"/)
  })

  it('index.html has color-scheme: dark', () => {
    const html = readFileSync(join(import.meta.dir, '../../index.html'), 'utf8')
    expect(html).toMatch(/color-scheme:\s*dark/)
  })
})
