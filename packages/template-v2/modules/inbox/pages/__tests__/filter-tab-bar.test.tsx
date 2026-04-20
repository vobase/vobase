import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { type FilterKey, FilterTabBar } from '../filter-tab-bar'

describe('FilterTabBar', () => {
  it('renders role="tablist" for a11y', () => {
    const html = renderToStaticMarkup(<FilterTabBar value="active" onChange={() => {}} />)
    expect(html).toContain('role="tablist"')
  })

  it('renders all three tabs', () => {
    const html = renderToStaticMarkup(<FilterTabBar value="active" onChange={() => {}} />)
    expect(html).toContain('Active')
    expect(html).toContain('Later')
    expect(html).toContain('Done')
  })

  it('marks active tab with aria-selected="true"', () => {
    const tabs: FilterKey[] = ['active', 'later', 'done']
    for (const tab of tabs) {
      const html = renderToStaticMarkup(<FilterTabBar value={tab} onChange={() => {}} />)
      const matches = html.match(/aria-selected="true"/g) ?? []
      expect(matches).toHaveLength(1)
    }
  })

  it('calls onChange with correct FilterKey when tab value changes', () => {
    const onChange = mock((_v: FilterKey) => {})
    const tabs: FilterKey[] = ['later', 'done', 'active']
    for (const tab of tabs) onChange(tab)
    expect(onChange).toHaveBeenCalledTimes(3)
    expect(onChange).toHaveBeenCalledWith('active')
    expect(onChange).toHaveBeenCalledWith('later')
    expect(onChange).toHaveBeenCalledWith('done')
  })

  it('renders counts in parens when provided', () => {
    const html = renderToStaticMarkup(
      <FilterTabBar value="active" onChange={() => {}} counts={{ active: 12, later: 3 }} />,
    )
    expect(html).toContain('(12)')
    expect(html).toContain('(3)')
  })

  it('omits count when not provided for a tab', () => {
    const html = renderToStaticMarkup(<FilterTabBar value="active" onChange={() => {}} counts={{ active: 5 }} />)
    const parenMatches = html.match(/\(\d+\)/g) ?? []
    expect(parenMatches).toHaveLength(1)
    expect(parenMatches[0]).toBe('(5)')
  })

  it('renders ToggleGroup with data-slot="toggle-group"', () => {
    const html = renderToStaticMarkup(<FilterTabBar value="active" onChange={() => {}} />)
    expect(html).toContain('data-slot="toggle-group"')
  })
})
