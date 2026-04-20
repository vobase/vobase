import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { OwnershipFilter } from '../ownership-filter'

describe('OwnershipFilter', () => {
  it('renders trigger button with owner label', () => {
    const html = renderToStaticMarkup(<OwnershipFilter value="all" onChange={() => {}} options={[]} />)
    expect(html).toContain('Filter by owner')
  })

  it('encodes current value as data attribute', () => {
    const html = renderToStaticMarkup(<OwnershipFilter value="mine" onChange={() => {}} options={[]} />)
    expect(html).toContain('data-owner-value="mine"')
  })
})
