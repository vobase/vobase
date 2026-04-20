import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

let memoryState = { memory: null as string | null, isPending: false }

mock.module('@modules/inbox/pages/api/use-working-memory', () => ({
  useWorkingMemory: () => memoryState,
}))

import { WorkingMemoryPanel } from '../working-memory-panel'

describe('WorkingMemoryPanel', () => {
  it('renders memory text when available', () => {
    memoryState = { memory: 'The agent remembers context here.', isPending: false }
    const html = renderToStaticMarkup(<WorkingMemoryPanel conversationId="conv_abc" />)
    expect(html).toContain('The agent remembers context here.')
  })

  it('renders empty state when memory is null', () => {
    memoryState = { memory: null, isPending: false }
    const html = renderToStaticMarkup(<WorkingMemoryPanel conversationId="conv_abc" />)
    expect(html).toContain('No memory yet for this agent')
  })

  it('renders loading state when isPending', () => {
    memoryState = { memory: null, isPending: true }
    const html = renderToStaticMarkup(<WorkingMemoryPanel conversationId="conv_abc" />)
    expect(html).toContain('Loading')
  })
})
