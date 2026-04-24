import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { PaneHeader } from '../pane-header'

describe('PaneHeader', () => {
  it('renders title', () => {
    const html = renderToStaticMarkup(<PaneHeader title="Messaging" />)
    expect(html).toContain('Messaging')
  })

  it('renders meta when provided', () => {
    const html = renderToStaticMarkup(<PaneHeader title="T" meta={<span>5/10</span>} />)
    expect(html).toContain('5/10')
  })

  it('renders actions when provided', () => {
    const html = renderToStaticMarkup(<PaneHeader title="T" actions={<button type="button">Search</button>} />)
    expect(html).toContain('Search')
  })

  it('renders filters inline', () => {
    const html = renderToStaticMarkup(<PaneHeader title="T" filters={<span>All</span>} />)
    expect(html).toContain('All')
  })

  it('enforces max-h-10 on header element', () => {
    const html = renderToStaticMarkup(<PaneHeader title="T" filters={<span>chip</span>} />)
    expect(html).toContain('max-h-10')
  })

  it('applies list density padding by default', () => {
    const html = renderToStaticMarkup(<PaneHeader title="T" />)
    expect(html).toContain('px-3')
  })

  it('applies detail density padding', () => {
    const html = renderToStaticMarkup(<PaneHeader title="T" density="detail" />)
    expect(html).toContain('px-4')
  })
})
