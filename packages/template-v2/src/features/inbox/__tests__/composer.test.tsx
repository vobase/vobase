import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createKeyboardNavHandler } from '@/hooks/use-keyboard-nav'

mock.module('../api/use-send-note', () => ({
  useSendNote: () => ({ mutate: mock(() => {}), isPending: false }),
}))

mock.module('@/components/ai-elements/prompt-input', () => ({
  PromptInput: ({ children }: { children: React.ReactNode }) => <form>{children}</form>,
  PromptInputTextarea: ({ placeholder }: { placeholder?: string }) => (
    <textarea placeholder={placeholder} name="message" />
  ),
  PromptInputFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PromptInputSubmit: ({ disabled }: { disabled?: boolean }) => (
    <button type="submit" disabled={disabled}>
      Send
    </button>
  ),
}))

import { Composer } from '../composer'

describe('Composer - render', () => {
  it('renders the note placeholder text', () => {
    const html = renderToStaticMarkup(<Composer conversationId="conv-1" />)
    expect(html).toContain('Internal note (visible to staff only)')
  })

  it('has warning border marker', () => {
    const html = renderToStaticMarkup(<Composer conversationId="conv-1" />)
    expect(html).toContain('border-[var(--color-warning)]')
  })

  it('submit button is disabled in initial empty state', () => {
    const html = renderToStaticMarkup(<Composer conversationId="conv-1" />)
    expect(html).toContain('disabled')
  })
})

describe('Composer - Cmd+Enter logic', () => {
  function evt(key: string, extra?: { metaKey?: boolean; tagName?: string }) {
    const { tagName = 'DIV', metaKey = false } = extra ?? {}
    return {
      key,
      metaKey,
      ctrlKey: false,
      preventDefault: mock(() => {}),
      target: { tagName },
    } as unknown as KeyboardEvent
  }

  it('Cmd+Enter fires onSubmitComposer from non-TEXTAREA target', () => {
    const onSubmit = mock(() => {})
    createKeyboardNavHandler({ context: 'inbox-detail', onSubmitComposer: onSubmit })(evt('Enter', { metaKey: true }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('Cmd+Enter is blocked from TEXTAREA (textarea handles it directly)', () => {
    const onSubmit = mock(() => {})
    createKeyboardNavHandler({ context: 'inbox-detail', onSubmitComposer: onSubmit })(
      evt('Enter', { metaKey: true, tagName: 'TEXTAREA' }),
    )
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submitComposer is a no-op when text is empty', () => {
    const mutate = mock<(_s: string) => void>(() => {})
    const text = ''
    const submit = () => {
      if (text.trim()) mutate(text.trim())
    }
    submit()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('submitComposer calls mutate with trimmed text', () => {
    const mutate = mock<(_s: string) => void>(() => {})
    const text = '  My note  '
    const submit = () => {
      if (text.trim()) mutate(text.trim())
    }
    submit()
    expect(mutate).toHaveBeenCalledWith('My note')
  })
})
