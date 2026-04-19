import { describe, expect, it, mock } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import GeneralErrorPage from '../general-error'

describe('GeneralErrorPage — render', () => {
  it('renders error message', () => {
    const html = renderToStaticMarkup(<GeneralErrorPage error={new Error('Something exploded')} />)
    expect(html).toContain('Something exploded')
  })

  it('renders fallback message when no error provided', () => {
    const html = renderToStaticMarkup(<GeneralErrorPage />)
    expect(html).toContain('An unexpected error occurred')
  })

  it('renders Try again button', () => {
    const html = renderToStaticMarkup(<GeneralErrorPage />)
    expect(html).toContain('Try again')
  })
})

describe('GeneralErrorPage — reset behavior', () => {
  it('calls reset prop when onClick fires', () => {
    const reset = mock(() => {})
    function findOnClick(node: React.ReactNode): (() => void) | undefined {
      if (!React.isValidElement(node)) return undefined
      const el = node as React.ReactElement<{ onClick?: () => void; children?: React.ReactNode }>
      if (typeof el.props.onClick === 'function') return el.props.onClick
      const children = el.props.children
      if (!children) return undefined
      const kids = Array.isArray(children) ? children : [children]
      for (const child of kids) {
        const found = findOnClick(child)
        if (found) return found
      }
      return undefined
    }
    const rendered = GeneralErrorPage({ reset }) as React.ReactElement
    const onClick = findOnClick(rendered)
    expect(onClick).toBeDefined()
    onClick?.()
    expect(reset).toHaveBeenCalledTimes(1)
  })
})
