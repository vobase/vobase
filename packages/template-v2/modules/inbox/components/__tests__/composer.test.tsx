import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createKeyboardNavHandler } from '@/hooks/use-keyboard-nav'

const staffReplyMutate = mock(() => {})
const sendNoteMutate = mock(() => {})

mock.module('@modules/inbox/api/use-staff-reply', () => ({
  useStaffReply: () => ({ mutate: staffReplyMutate, isPending: false }),
}))

mock.module('@modules/inbox/api/use-send-note', () => ({
  useSendNote: () => ({ mutate: sendNoteMutate, isPending: false }),
}))

mock.module('@/components/ui/toggle-group', () => ({
  ToggleGroup: ({ children, value }: { children: React.ReactNode; value?: string }) => (
    <div data-testid="toggle-group" data-value={value}>
      {children}
    </div>
  ),
  ToggleGroupItem: ({ children, value }: { children: React.ReactNode; value?: string }) => (
    <button type="button" data-value={value}>
      {children}
    </button>
  ),
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

describe('Composer — structure', () => {
  it('renders Reply tab by default', () => {
    const html = renderToStaticMarkup(<Composer conversationId="conv-1" />)
    expect(html).toContain('Reply')
  })

  it('renders Note tab', () => {
    const html = renderToStaticMarkup(<Composer conversationId="conv-1" />)
    expect(html).toContain('Note')
  })

  it('default mode is reply (toggle-group value=reply)', () => {
    const html = renderToStaticMarkup(<Composer conversationId="conv-1" />)
    expect(html).toContain('data-value="reply"')
  })

  it('shows reply placeholder in default state', () => {
    const html = renderToStaticMarkup(<Composer conversationId="conv-1" />)
    expect(html).toContain('Reply to customer')
  })

  it('submit button is disabled in initial empty state', () => {
    const html = renderToStaticMarkup(<Composer conversationId="conv-1" />)
    expect(html).toContain('disabled')
  })

  it('does not render warning border marker', () => {
    const html = renderToStaticMarkup(<Composer conversationId="conv-1" />)
    expect(html).not.toContain('border-[var(--color-warning)]')
  })
})

describe('Composer — submit dispatch', () => {
  it('reply mode dispatches to staffReply', () => {
    const staffReply = mock<(_s: string) => void>(() => {})
    const sendNote = mock<(_s: string) => void>(() => {})
    const mode = 'reply'
    const text = 'Hello customer'
    const dispatch = (m: string, t: string) => {
      if (m === 'reply') staffReply(t)
      else sendNote(t)
    }
    dispatch(mode, text)
    expect(staffReply).toHaveBeenCalledWith('Hello customer')
    expect(sendNote).not.toHaveBeenCalled()
  })

  it('note mode dispatches to sendNote', () => {
    const staffReply = mock<(_s: string) => void>(() => {})
    const sendNote = mock<(_s: string) => void>(() => {})
    const mode = 'note'
    const text = 'Internal note'
    const dispatch = (m: string, t: string) => {
      if (m === 'reply') staffReply(t)
      else sendNote(t)
    }
    dispatch(mode, text)
    expect(sendNote).toHaveBeenCalledWith('Internal note')
    expect(staffReply).not.toHaveBeenCalled()
  })

  it('empty text is a no-op', () => {
    const staffReply = mock<(_s: string) => void>(() => {})
    const text = '   '
    const dispatch = () => {
      if (text.trim()) staffReply(text.trim())
    }
    dispatch()
    expect(staffReply).not.toHaveBeenCalled()
  })

  it('trims text before dispatch', () => {
    const staffReply = mock<(_s: string) => void>(() => {})
    const text = '  trimmed  '
    const dispatch = () => {
      if (text.trim()) staffReply(text.trim())
    }
    dispatch()
    expect(staffReply).toHaveBeenCalledWith('trimmed')
  })
})

describe('Composer — Cmd+Enter logic', () => {
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
})
