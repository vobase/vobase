import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('@modules/settings/hooks/use-settings-save', () => ({
  useSettingsSave: () => ({ mutate: mock(async () => {}), isPending: false }),
}))

import ApiKeysPage from './api-keys'

describe('ApiKeysPage — render', () => {
  it('renders API keys heading', () => {
    const html = renderToStaticMarkup(<ApiKeysPage />)
    expect(html).toContain('API keys')
  })

  it('renders key name input', () => {
    const html = renderToStaticMarkup(<ApiKeysPage />)
    expect(html).toContain('Key name')
  })

  it('renders scope field', () => {
    const html = renderToStaticMarkup(<ApiKeysPage />)
    expect(html).toContain('Scope')
  })

  it('renders create button', () => {
    const html = renderToStaticMarkup(<ApiKeysPage />)
    expect(html).toContain('Create key')
  })
})
