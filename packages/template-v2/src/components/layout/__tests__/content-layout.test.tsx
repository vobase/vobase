import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ContentLayout } from '../content-layout'

describe('ContentLayout', () => {
  it('renders subNav slot', () => {
    const html = renderToStaticMarkup(
      <ContentLayout subNav={<div>nav-content</div>} content={<div>main-content</div>} />,
    )
    expect(html).toContain('nav-content')
  })

  it('renders content slot', () => {
    const html = renderToStaticMarkup(<ContentLayout subNav={<div>nav</div>} content={<div>main-content</div>} />)
    expect(html).toContain('main-content')
  })

  it('renders header slot when provided', () => {
    const html = renderToStaticMarkup(
      <ContentLayout header={<div>header-content</div>} subNav={<div>nav</div>} content={<div>main</div>} />,
    )
    expect(html).toContain('header-content')
  })

  it('omits header when not provided', () => {
    const html = renderToStaticMarkup(<ContentLayout subNav={<div>nav</div>} content={<div>main</div>} />)
    expect(html).not.toContain('header-content')
  })

  it('renders secondaryStrip when provided', () => {
    const html = renderToStaticMarkup(
      <ContentLayout secondaryStrip={<span>strip-content</span>} subNav={<div>nav</div>} content={<div>main</div>} />,
    )
    expect(html).toContain('strip-content')
  })

  it('renders right slot when provided', () => {
    const html = renderToStaticMarkup(
      <ContentLayout subNav={<div>nav</div>} content={<div>main</div>} right={<div>right-content</div>} />,
    )
    expect(html).toContain('right-content')
  })

  it('omits right slot when not provided', () => {
    const html = renderToStaticMarkup(<ContentLayout subNav={<div>nav</div>} content={<div>main</div>} />)
    expect(html).not.toContain('right-content')
  })

  it('subNav column is 220px wide', () => {
    const html = renderToStaticMarkup(<ContentLayout subNav={<div>nav</div>} content={<div>main</div>} />)
    expect(html).toContain('w-[220px]')
  })

  it('right rail is 320px wide', () => {
    const html = renderToStaticMarkup(
      <ContentLayout subNav={<div>nav</div>} content={<div>main</div>} right={<div>rail</div>} />,
    )
    expect(html).toContain('w-[320px]')
  })
})
