import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import * as realRouter from '@tanstack/react-router'

mock.module('@tanstack/react-router', () => ({
  ...realRouter,
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}))

import NotFoundPage from '../not-found'

describe('NotFoundPage — render', () => {
  it('renders 404 title', () => {
    const html = renderToStaticMarkup(<NotFoundPage />)
    expect(html).toContain('404')
  })

  it('renders page not found description', () => {
    const html = renderToStaticMarkup(<NotFoundPage />)
    expect(html).toContain('Page not found')
  })

  it('renders Back to Inbox link', () => {
    const html = renderToStaticMarkup(<NotFoundPage />)
    expect(html).toContain('Back to Inbox')
  })
})
