import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SnoozeMenu } from '../snooze-menu'

describe('SnoozeMenu', () => {
  it('renders trigger with aria-label', () => {
    const html = renderToStaticMarkup(<SnoozeMenu conversationId="c1" by="staff" />)
    expect(html).toContain('Snooze')
    expect(html).toContain('aria-label="Snooze"')
  })
})
