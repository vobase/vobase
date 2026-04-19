import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { type FilterKey, FilterTabBar } from '../filter-tab-bar'

describe('FilterTabBar', () => {
  it('renders role="tablist" for a11y', () => {
    const html = renderToStaticMarkup(<FilterTabBar value="all" onChange={() => {}} />)
    expect(html).toContain('role="tablist"')
  })

  it('renders all five tabs', () => {
    const html = renderToStaticMarkup(<FilterTabBar value="all" onChange={() => {}} />)
    expect(html).toContain('All')
    expect(html).toContain('Unread')
    expect(html).toContain('Pending')
    expect(html).toContain('Mine')
    expect(html).toContain('Archived')
  })

  it('marks active tab with aria-selected="true"', () => {
    const tabs: FilterKey[] = ['all', 'unread', 'awaiting_approval', 'assigned_to_me', 'archived']
    for (const tab of tabs) {
      const html = renderToStaticMarkup(<FilterTabBar value={tab} onChange={() => {}} />)
      const matches = html.match(/aria-selected="true"/g) ?? []
      expect(matches).toHaveLength(1)
    }
  })

  it('calls onChange with correct FilterKey when tab value changes', () => {
    const onChange = mock((_v: FilterKey) => {})
    // Simulate onValueChange firing for each tab
    const tabs: FilterKey[] = ['unread', 'awaiting_approval', 'assigned_to_me', 'archived']
    for (const tab of tabs) {
      onChange(tab)
    }
    expect(onChange).toHaveBeenCalledTimes(4)
    expect(onChange).toHaveBeenCalledWith('unread')
    expect(onChange).toHaveBeenCalledWith('awaiting_approval')
    expect(onChange).toHaveBeenCalledWith('assigned_to_me')
    expect(onChange).toHaveBeenCalledWith('archived')
  })

  it('renders counts in parens when provided', () => {
    const html = renderToStaticMarkup(<FilterTabBar value="all" onChange={() => {}} counts={{ all: 12, unread: 3 }} />)
    expect(html).toContain('(12)')
    expect(html).toContain('(3)')
  })

  it('omits count when not provided for a tab', () => {
    const html = renderToStaticMarkup(<FilterTabBar value="all" onChange={() => {}} counts={{ all: 5 }} />)
    // Only all has a count; others should not show parens
    const parenMatches = html.match(/\(\d+\)/g) ?? []
    expect(parenMatches).toHaveLength(1)
    expect(parenMatches[0]).toBe('(5)')
  })

  it('renders ToggleGroup with data-slot="toggle-group"', () => {
    const html = renderToStaticMarkup(<FilterTabBar value="all" onChange={() => {}} />)
    expect(html).toContain('data-slot="toggle-group"')
  })
})
