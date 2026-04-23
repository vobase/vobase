import { describe, expect, it, mock } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('@server/admin/settings/pages/api/use-settings-save', () => ({
  useSettingsSave: () => ({ mutate: mock(async () => {}), isPending: false }),
}))

import NotificationsPage from '../notifications'

function render(): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <NotificationsPage />
    </QueryClientProvider>,
  )
}

describe('NotificationsPage — render', () => {
  it('renders Notifications heading', () => {
    expect(render()).toContain('Notifications')
  })

  it('renders mention notifications toggle', () => {
    expect(render()).toContain('Mention notifications')
  })

  it('renders whatsapp toggle', () => {
    expect(render()).toContain('WhatsApp')
  })

  it('renders save button', () => {
    expect(render()).toContain('Save notifications')
  })
})
