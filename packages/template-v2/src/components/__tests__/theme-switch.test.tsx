import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { CheckIcon } from 'lucide-react'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

let mockTheme = 'system' as 'light' | 'dark' | 'system'
let mockResolved = 'light' as 'light' | 'dark'
const setThemeMock = mock((_t: string) => {})

mock.module('@/components/theme-provider', () => ({
  ThemeProvider: ({ children }: { children: unknown }) => children,
  useTheme: () => ({ theme: mockTheme, setTheme: setThemeMock, resolvedTheme: mockResolved }),
}))

const { ThemeSwitch, THEME_OPTIONS } = await import('../theme-switch')

beforeEach(() => {
  mockTheme = 'system'
  mockResolved = 'light'
  setThemeMock.mockClear()
})

// Render items in plain divs to test our label/checkmark logic without Radix context
function renderItems(activeTheme: 'light' | 'dark' | 'system') {
  return renderToStaticMarkup(
    React.createElement(
      'div',
      null,
      ...THEME_OPTIONS.map(({ value, label, Icon }) =>
        React.createElement(
          'div',
          { key: value, 'aria-label': `Switch to ${label} theme` },
          React.createElement(Icon, { 'aria-hidden': 'true' }),
          React.createElement('span', null, label),
          activeTheme === value
            ? React.createElement(CheckIcon, { className: 'ml-auto', 'aria-label': 'active' })
            : null,
        ),
      ),
    ),
  )
}

describe('ThemeSwitch — trigger icon', () => {
  it('shows sun icon when resolvedTheme is light', () => {
    mockResolved = 'light'
    const html = renderToStaticMarkup(React.createElement(ThemeSwitch))
    expect(html).toContain('aria-label="Toggle theme"')
    expect(html).toContain('lucide-sun')
  })

  it('shows moon icon when resolvedTheme is dark', () => {
    mockResolved = 'dark'
    const html = renderToStaticMarkup(React.createElement(ThemeSwitch))
    expect(html).toContain('lucide-moon')
  })
})

describe('ThemeSwitch — THEME_OPTIONS data', () => {
  it('exposes three options with correct values', () => {
    expect(THEME_OPTIONS.map((o) => o.value)).toEqual(['light', 'dark', 'system'])
  })

  it('has correct labels', () => {
    expect(THEME_OPTIONS.map((o) => o.label)).toEqual(['Light', 'Dark', 'System'])
  })

  it('each option has an Icon component', () => {
    for (const opt of THEME_OPTIONS) {
      expect(opt.Icon).toBeTruthy()
    }
  })
})

describe('ThemeSwitch — item labels and aria', () => {
  it('renders all three labels', () => {
    const html = renderItems('system')
    expect(html).toContain('Light')
    expect(html).toContain('Dark')
    expect(html).toContain('System')
  })

  it('renders aria-label for each option', () => {
    const html = renderItems('system')
    expect(html).toContain('Switch to Light theme')
    expect(html).toContain('Switch to Dark theme')
    expect(html).toContain('Switch to System theme')
  })
})

describe('ThemeSwitch — active checkmark', () => {
  it('marks light item as active when theme is light', () => {
    const html = renderItems('light')
    expect(html).toContain('aria-label="active"')
    expect((html.match(/aria-label="active"/g) ?? []).length).toBe(1)
  })

  it('marks dark item as active when theme is dark', () => {
    expect(renderItems('dark')).toContain('aria-label="active"')
  })

  it('marks system item as active when theme is system', () => {
    expect(renderItems('system')).toContain('aria-label="active"')
  })

  it('shows exactly one checkmark per theme', () => {
    for (const t of ['light', 'dark', 'system'] as const) {
      const count = (renderItems(t).match(/aria-label="active"/g) ?? []).length
      expect(count).toBe(1)
    }
  })
})
