import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('@server/admin/settings/pages/api/use-settings-save', () => ({
  useSettingsSave: () => ({ mutate: mock(async () => {}), isPending: false }),
}))

mock.module('@/components/theme-provider', () => ({
  ThemeProvider: ({ children }: { children: unknown }) => children,
  useTheme: () => ({ theme: 'system', setTheme: mock(() => {}), resolvedTheme: 'light' }),
}))

mock.module('@/components/theme-switch', () => ({
  ThemeSwitch: () => null,
  THEME_OPTIONS: [],
}))

import AppearancePage from '../appearance'

describe('AppearancePage — render', () => {
  it('renders Appearance heading', () => {
    const html = renderToStaticMarkup(<AppearancePage />)
    expect(html).toContain('Appearance')
  })

  it('renders Theme label', () => {
    const html = renderToStaticMarkup(<AppearancePage />)
    expect(html).toContain('Theme')
  })

  it('renders Font size label', () => {
    const html = renderToStaticMarkup(<AppearancePage />)
    expect(html).toContain('Font size')
  })

  it('renders save button', () => {
    const html = renderToStaticMarkup(<AppearancePage />)
    expect(html).toContain('Save appearance')
  })
})
