import { describe, expect, it } from 'bun:test'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { renderToStaticMarkup } from 'react-dom/server'
import { ListDetailLayout } from '../list-detail-layout'

function render(ui: React.ReactNode, searchParams = '') {
  return renderToStaticMarkup(<NuqsTestingAdapter searchParams={searchParams}>{ui}</NuqsTestingAdapter>)
}

describe('ListDetailLayout', () => {
  it('renders list slot', () => {
    const html = render(<ListDetailLayout list={<div>list-content</div>} detail={<div>detail-content</div>} />)
    expect(html).toContain('list-content')
  })

  it('renders detail slot', () => {
    const html = render(<ListDetailLayout list={<div>list</div>} detail={<div>detail-content</div>} />)
    expect(html).toContain('detail-content')
  })

  it('hides right slot by default (ctx=closed)', () => {
    const html = render(
      <ListDetailLayout list={<div>list</div>} detail={<div>detail</div>} right={<div>right-content</div>} />,
    )
    expect(html).not.toContain('right-content')
  })

  it('shows right slot when ?ctx=open', () => {
    const html = render(
      <ListDetailLayout list={<div>list</div>} detail={<div>detail</div>} right={<div>right-content</div>} />,
      '?ctx=open',
    )
    expect(html).toContain('right-content')
  })
})
