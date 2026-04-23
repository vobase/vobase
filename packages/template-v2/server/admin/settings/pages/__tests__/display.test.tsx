import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('@server/admin/settings/pages/api/use-settings-save', () => ({
  useSettingsSave: () => ({ mutate: mock(async () => {}), isPending: false }),
}))

import DisplayPage from '../display'

describe('DisplayPage — render', () => {
  it('renders Display heading', () => {
    const html = renderToStaticMarkup(<DisplayPage />)
    expect(html).toContain('Display')
  })

  it('renders density field', () => {
    const html = renderToStaticMarkup(<DisplayPage />)
    expect(html).toContain('Density')
  })

  it('renders show avatars toggle', () => {
    const html = renderToStaticMarkup(<DisplayPage />)
    expect(html).toContain('Show avatars')
  })

  it('renders save button', () => {
    const html = renderToStaticMarkup(<DisplayPage />)
    expect(html).toContain('Save display')
  })
})
