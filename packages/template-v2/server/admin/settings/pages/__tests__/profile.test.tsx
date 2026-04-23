import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('@server/admin/settings/pages/api/use-settings-save', () => ({
  useSettingsSave: () => ({ mutate: mock(async () => {}), isPending: false }),
}))

import ProfilePage from '../profile'

describe('ProfilePage — render', () => {
  it('renders Profile heading', () => {
    const html = renderToStaticMarkup(<ProfilePage />)
    expect(html).toContain('Profile')
  })

  it('renders display name input', () => {
    const html = renderToStaticMarkup(<ProfilePage />)
    expect(html).toContain('Display name')
  })

  it('renders email input', () => {
    const html = renderToStaticMarkup(<ProfilePage />)
    expect(html).toContain('type="email"')
  })

  it('renders save button', () => {
    const html = renderToStaticMarkup(<ProfilePage />)
    expect(html).toContain('Save profile')
  })
})
