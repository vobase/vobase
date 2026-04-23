import { describe, expect, it, mock } from 'bun:test'
import { createKeyboardNavHandler, createShellKeyboardNavHandler } from '../use-keyboard-nav'

function evt(key: string, extra?: { metaKey?: boolean; ctrlKey?: boolean; tagName?: string }) {
  const { tagName = 'DIV', metaKey = false, ctrlKey = false } = extra ?? {}
  return {
    key,
    metaKey,
    ctrlKey,
    preventDefault: mock(() => {}),
    target: { tagName, contentEditable: 'inherit' },
  } as unknown as KeyboardEvent
}

describe('createKeyboardNavHandler', () => {
  it('j → onSelectNext', () => {
    const fn = mock(() => {})
    createKeyboardNavHandler({ context: 'messaging-list', onSelectNext: fn })(evt('j'))
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('k → onSelectPrev', () => {
    const fn = mock(() => {})
    createKeyboardNavHandler({ context: 'messaging-list', onSelectPrev: fn })(evt('k'))
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('Enter → onOpenSelected', () => {
    const fn = mock(() => {})
    createKeyboardNavHandler({ context: 'messaging-list', onOpenSelected: fn })(evt('Enter'))
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('Escape → onClearSelection', () => {
    const fn = mock(() => {})
    createKeyboardNavHandler({ context: 'messaging-list', onClearSelection: fn })(evt('Escape'))
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('Cmd+Enter → onSubmitComposer, not onOpenSelected', () => {
    const submit = mock(() => {})
    const open = mock(() => {})
    createKeyboardNavHandler({ context: 'messaging-detail', onSubmitComposer: submit, onOpenSelected: open })(
      evt('Enter', { metaKey: true }),
    )
    expect(submit).toHaveBeenCalledTimes(1)
    expect(open).not.toHaveBeenCalled()
  })

  it('ignores j from INPUT target', () => {
    const fn = mock(() => {})
    createKeyboardNavHandler({ context: 'messaging-list', onSelectNext: fn })(evt('j', { tagName: 'INPUT' }))
    expect(fn).not.toHaveBeenCalled()
  })

  it('ignores j from TEXTAREA target', () => {
    const fn = mock(() => {})
    createKeyboardNavHandler({ context: 'messaging-list', onSelectNext: fn })(evt('j', { tagName: 'TEXTAREA' }))
    expect(fn).not.toHaveBeenCalled()
  })

  it('ignores j from SELECT target', () => {
    const fn = mock(() => {})
    createKeyboardNavHandler({ context: 'messaging-list', onSelectNext: fn })(evt('j', { tagName: 'SELECT' }))
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('createShellKeyboardNavHandler', () => {
  it('g s → onNavigate /settings', () => {
    const onNavigate = mock((_path: string) => {})
    const { handler } = createShellKeyboardNavHandler({ onNavigate })
    handler(evt('g'))
    handler(evt('s'))
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(onNavigate).toHaveBeenCalledWith('/settings')
  })

  it('g i → onNavigate /messaging', () => {
    const onNavigate = mock((_path: string) => {})
    const { handler } = createShellKeyboardNavHandler({ onNavigate })
    handler(evt('g'))
    handler(evt('i'))
    expect(onNavigate).toHaveBeenCalledWith('/messaging')
  })

  it('g h → onNavigate /messaging (alias)', () => {
    const onNavigate = mock((_path: string) => {})
    const { handler } = createShellKeyboardNavHandler({ onNavigate })
    handler(evt('g'))
    handler(evt('h'))
    expect(onNavigate).toHaveBeenCalledWith('/messaging')
  })

  it('g alone + 500ms timeout → navigate NOT fired', async () => {
    const onNavigate = mock((_path: string) => {})
    const { handler } = createShellKeyboardNavHandler({ onNavigate })
    handler(evt('g'))
    await new Promise((r) => setTimeout(r, 550))
    // after timeout, pendingG cleared — next key should not navigate
    handler(evt('s'))
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('g in INPUT target → sequence NOT started', () => {
    const onNavigate = mock((_path: string) => {})
    const { handler } = createShellKeyboardNavHandler({ onNavigate })
    handler(evt('g', { tagName: 'INPUT' }))
    handler(evt('s'))
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('Esc → onCloseDialog fired', () => {
    const onCloseDialog = mock(() => {})
    const { handler } = createShellKeyboardNavHandler({ onCloseDialog })
    handler(evt('Escape'))
    expect(onCloseDialog).toHaveBeenCalledTimes(1)
  })
})
