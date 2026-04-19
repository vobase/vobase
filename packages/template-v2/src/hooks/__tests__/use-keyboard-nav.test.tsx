import { describe, expect, it, mock } from 'bun:test'
import { createKeyboardNavHandler } from '../use-keyboard-nav'

function evt(key: string, extra?: { metaKey?: boolean; ctrlKey?: boolean; tagName?: string }) {
  const { tagName = 'DIV', metaKey = false, ctrlKey = false } = extra ?? {}
  return {
    key,
    metaKey,
    ctrlKey,
    preventDefault: mock(() => {}),
    target: { tagName },
  } as unknown as KeyboardEvent
}

describe('createKeyboardNavHandler', () => {
  it('j → onSelectNext', () => {
    const fn = mock(() => {})
    createKeyboardNavHandler({ context: 'inbox-list', onSelectNext: fn })(evt('j'))
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('k → onSelectPrev', () => {
    const fn = mock(() => {})
    createKeyboardNavHandler({ context: 'inbox-list', onSelectPrev: fn })(evt('k'))
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('Enter → onOpenSelected', () => {
    const fn = mock(() => {})
    createKeyboardNavHandler({ context: 'inbox-list', onOpenSelected: fn })(evt('Enter'))
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('Escape → onClearSelection', () => {
    const fn = mock(() => {})
    createKeyboardNavHandler({ context: 'inbox-list', onClearSelection: fn })(evt('Escape'))
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('Cmd+Enter → onSubmitComposer, not onOpenSelected', () => {
    const submit = mock(() => {})
    const open = mock(() => {})
    createKeyboardNavHandler({ context: 'inbox-detail', onSubmitComposer: submit, onOpenSelected: open })(
      evt('Enter', { metaKey: true }),
    )
    expect(submit).toHaveBeenCalledTimes(1)
    expect(open).not.toHaveBeenCalled()
  })

  it('ignores j from INPUT target', () => {
    const fn = mock(() => {})
    createKeyboardNavHandler({ context: 'inbox-list', onSelectNext: fn })(evt('j', { tagName: 'INPUT' }))
    expect(fn).not.toHaveBeenCalled()
  })

  it('ignores j from TEXTAREA target', () => {
    const fn = mock(() => {})
    createKeyboardNavHandler({ context: 'inbox-list', onSelectNext: fn })(evt('j', { tagName: 'TEXTAREA' }))
    expect(fn).not.toHaveBeenCalled()
  })

  it('ignores j from SELECT target', () => {
    const fn = mock(() => {})
    createKeyboardNavHandler({ context: 'inbox-list', onSelectNext: fn })(evt('j', { tagName: 'SELECT' }))
    expect(fn).not.toHaveBeenCalled()
  })
})
