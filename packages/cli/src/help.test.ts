import { describe, expect, it } from 'bun:test'

import type { Catalog } from './catalog'
import { renderGlobalHelp, renderGroupHelp } from './help'

const catalog: Catalog = {
  etag: 'e',
  verbs: [
    {
      name: 'contacts list',
      description: 'List contacts',
      inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
      route: '/api/cli/contacts/list',
    },
    {
      name: 'contacts show',
      description: 'Show one',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      route: '/api/cli/contacts/show',
    },
    {
      name: 'drive ls',
      description: 'List drive',
      inputSchema: { type: 'object' },
      route: '/api/cli/drive/ls',
    },
  ],
}

describe('renderGlobalHelp', () => {
  it('lists groups with verb counts', () => {
    const out = renderGlobalHelp(catalog)
    expect(out).toContain('vobase')
    expect(out).toContain('contacts')
    expect(out).toContain('drive')
    expect(out).toContain('2 verbs')
    expect(out).toContain('List drive')
  })

  it('handles empty catalog', () => {
    const out = renderGlobalHelp({ etag: 'e', verbs: [] })
    expect(out).toContain('No verbs available')
  })

  it('lists global flags', () => {
    const out = renderGlobalHelp(catalog)
    expect(out).toContain('--config')
    expect(out).toContain('--json')
    expect(out).toContain('--refresh')
  })
})

describe('renderGroupHelp', () => {
  it('lists verbs in the group with their descriptions', () => {
    const out = renderGroupHelp(catalog, 'contacts')
    expect(out).toContain('vobase contacts list')
    expect(out).toContain('List contacts')
    expect(out).toContain('vobase contacts show')
    expect(out).toContain('Show one')
  })

  it('summarizes required vs optional flags', () => {
    const out = renderGroupHelp(catalog, 'contacts')
    expect(out).toContain('--id=<string>')
    expect(out).toContain('[--limit=<number>]')
  })

  it('returns a friendly message for unknown groups', () => {
    expect(renderGroupHelp(catalog, 'nope')).toContain("no verbs found for group 'nope'")
  })
})
