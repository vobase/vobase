import { describe, expect, it } from 'bun:test'

import { formatRelative, formatResult } from './output'

describe('formatResult json mode', () => {
  it('emits raw JSON regardless of hint', () => {
    const out = formatResult([{ id: 'c1' }], { format: 'json', hint: 'table:cols=id' })
    expect(out).toBe('[\n  {\n    "id": "c1"\n  }\n]\n')
  })
})

describe('formatResult human mode — table hint', () => {
  it('renders a column-aligned table with header + separator', () => {
    const rows = [
      { id: 'c1', displayName: 'Alice', phone: '111' },
      { id: 'c2', displayName: 'Bob', phone: '222' },
    ]
    const out = formatResult(rows, { format: 'human', hint: 'table:cols=id,displayName,phone' })
    const lines = out.trimEnd().split('\n')
    expect(lines[0]).toContain('ID')
    expect(lines[0]).toContain('DISPLAYNAME')
    expect(lines[0]).toContain('PHONE')
    expect(lines[1]).toMatch(/^-+/)
    expect(lines[2]).toContain('c1')
    expect(lines[2]).toContain('Alice')
    expect(lines[3]).toContain('c2')
    expect(lines[3]).toContain('Bob')
  })

  it('renders empty table with placeholder', () => {
    expect(formatResult([], { format: 'human', hint: 'table:cols=id' })).toBe('(no rows)\n')
  })

  it('renders dates as relative time', () => {
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const out = formatResult([{ id: 'c1', createdAt: past }], {
      format: 'human',
      hint: 'table:cols=id,createdAt',
    })
    expect(out).toContain('2 hours ago')
  })

  it('falls back to JSON pretty-print when value is not an array', () => {
    const out = formatResult({ count: 3 }, { format: 'human', hint: 'table:cols=count' })
    expect(out).toContain('"count": 3')
  })
})

describe('formatResult human mode — lines hint', () => {
  it('renders one line per array element from named field', () => {
    const out = formatResult([{ path: '/a' }, { path: '/b/c' }], { format: 'human', hint: 'lines:field=path' })
    expect(out).toBe('/a\n/b/c\n')
  })

  it('renders empty placeholder', () => {
    expect(formatResult([], { format: 'human', hint: 'lines:field=path' })).toBe('(no items)\n')
  })
})

describe('formatResult human mode — fallback', () => {
  it('summarizes arrays without a hint', () => {
    const out = formatResult([{ id: 'c1' }, { id: 'c2' }], { format: 'human' })
    expect(out).toContain('2 items')
    expect(out).toContain('"id": "c1"')
  })

  it('handles single-item array correctly', () => {
    const out = formatResult([{ id: 'c1' }], { format: 'human' })
    expect(out).toContain('1 item')
  })

  it('pretty-prints objects', () => {
    const out = formatResult({ name: 'demo' }, { format: 'human' })
    expect(out).toContain('"name": "demo"')
  })

  it('discards malformed hints and falls back to generic', () => {
    const out = formatResult([{ id: 'c1' }], { format: 'human', hint: 'banana' })
    expect(out).toContain('1 item')
  })
})

describe('formatRelative', () => {
  const now = new Date('2026-04-26T12:00:00Z')
  it('returns "just now" for sub-minute diffs', () => {
    expect(formatRelative(new Date(now.getTime() - 30_000), now)).toBe('just now')
  })
  it('returns minute phrasing', () => {
    expect(formatRelative(new Date(now.getTime() - 5 * 60_000), now)).toBe('5 minutes ago')
    expect(formatRelative(new Date(now.getTime() - 60_000), now)).toBe('1 minute ago')
  })
  it('returns hour phrasing', () => {
    expect(formatRelative(new Date(now.getTime() - 3 * 60 * 60_000), now)).toBe('3 hours ago')
  })
  it('returns day phrasing', () => {
    expect(formatRelative(new Date(now.getTime() - 5 * 24 * 60 * 60_000), now)).toBe('5 days ago')
  })
  it('returns ISO date for older diffs', () => {
    expect(formatRelative(new Date('2025-12-01T00:00:00Z'), now)).toBe('2025-12-01')
  })
  it('handles future dates with "in X" phrasing', () => {
    expect(formatRelative(new Date(now.getTime() + 5 * 60_000), now)).toBe('in 5 minutes')
  })
})
