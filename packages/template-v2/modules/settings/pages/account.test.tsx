import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('@modules/settings/hooks/use-settings-save', () => ({
  useSettingsSave: () => ({ mutate: mock(async () => {}), isPending: false }),
}))

import AccountPage from './account'

describe('AccountPage — render', () => {
  it('renders Account heading', () => {
    const html = renderToStaticMarkup(<AccountPage />)
    expect(html).toContain('Account')
  })

  it('renders timezone input', () => {
    const html = renderToStaticMarkup(<AccountPage />)
    expect(html).toContain('Timezone')
  })

  it('renders language input', () => {
    const html = renderToStaticMarkup(<AccountPage />)
    expect(html).toContain('Language')
  })

  it('renders save button', () => {
    const html = renderToStaticMarkup(<AccountPage />)
    expect(html).toContain('Save account')
  })
})
