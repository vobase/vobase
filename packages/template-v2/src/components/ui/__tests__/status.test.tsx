import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'bun:test'
import { Status } from '../status'

const variants = [
  'active',
  'resolving',
  'resolved',
  'compacted',
  'archived',
  'awaiting_approval',
  'failed',
  'success',
  'error',
  'warning',
  'info',
  'neutral',
] as const

describe('Status', () => {
  for (const variant of variants) {
    it(`renders variant ${variant}`, () => {
      const html = renderToStaticMarkup(<Status variant={variant} label={variant} />)
      expect(html).toMatchSnapshot()
    })
  }
})
