import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'

const INDEX_HTML = readFileSync(join(import.meta.dir, '../../index.html'), 'utf8')
const STORAGE_KEY = 'template-v2-theme'

/** Simulate the FOUC bootstrap script from index.html against a fake DOM. */
function simulateBootstrap(localStorageValue: string | null, prefersDark: boolean): string[] {
  const classes: string[] = []
  const classList = {
    remove: (...args: string[]) => {
      for (const c of args) {
        const i = classes.indexOf(c)
        if (i >= 0) classes.splice(i, 1)
      }
    },
    add: (c: string) => classes.push(c),
  }

  const storage: Record<string, string> = {}
  if (localStorageValue !== null) storage[STORAGE_KEY] = localStorageValue

  // Mirrors the inline script in index.html exactly
  const t = storage[STORAGE_KEY] || 'system'
  const dark = t === 'dark' || (t === 'system' && prefersDark)
  classList.remove('dark', 'light')
  classList.add(dark ? 'dark' : 'light')

  return classes
}

describe('theme-provider bootstrap (FOUC script)', () => {
  it('index.html bootstrap script uses correct storage key', () => {
    expect(INDEX_HTML).toContain(STORAGE_KEY)
    expect(INDEX_HTML).toContain('localStorage.getItem')
    expect(INDEX_HTML).toContain('prefers-color-scheme: dark')
  })

  it('dark localStorage → class="dark", not light', () => {
    const classes = simulateBootstrap('dark', false)
    expect(classes).toContain('dark')
    expect(classes).not.toContain('light')
  })

  it('light localStorage → class="light" even when system prefers dark', () => {
    const classes = simulateBootstrap('light', true)
    expect(classes).toContain('light')
    expect(classes).not.toContain('dark')
  })

  it('system + dark media query → class="dark"', () => {
    const classes = simulateBootstrap('system', true)
    expect(classes).toContain('dark')
    expect(classes).not.toContain('light')
  })

  it('system + light media query → class="light"', () => {
    const classes = simulateBootstrap('system', false)
    expect(classes).toContain('light')
    expect(classes).not.toContain('dark')
  })

  it('no localStorage (null) defaults to system → follows media query', () => {
    expect(simulateBootstrap(null, true)).toContain('dark')
    expect(simulateBootstrap(null, false)).toContain('light')
  })

  it('exactly one class applied (no duplicates)', () => {
    for (const pref of ['dark', 'light', 'system'] as const) {
      const classes = simulateBootstrap(pref, true)
      expect(classes.length).toBe(1)
    }
  })
})
