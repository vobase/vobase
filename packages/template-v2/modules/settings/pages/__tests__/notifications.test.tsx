import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('@modules/settings/pages/api/use-settings-save', () => ({
  useSettingsSave: () => ({ mutate: mock(async () => {}), isPending: false }),
}))

import NotificationsPage from '../notifications'

describe('NotificationsPage — render', () => {
  it('renders Notifications heading', () => {
    const html = renderToStaticMarkup(<NotificationsPage />)
    expect(html).toContain('Notifications')
  })

  it('renders email notifications toggle', () => {
    const html = renderToStaticMarkup(<NotificationsPage />)
    expect(html).toContain('Email notifications')
  })

  it('renders push notifications toggle', () => {
    const html = renderToStaticMarkup(<NotificationsPage />)
    expect(html).toContain('Push notifications')
  })

  it('renders save button', () => {
    const html = renderToStaticMarkup(<NotificationsPage />)
    expect(html).toContain('Save notifications')
  })
})
