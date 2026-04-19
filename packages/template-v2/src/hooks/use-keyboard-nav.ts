import { useCallback, useEffect, useRef } from 'react'

export interface UseKeyboardNavOptions {
  context: 'inbox-list' | 'inbox-detail'
  onSelectNext?: () => void
  onSelectPrev?: () => void
  onOpenSelected?: () => void
  onClearSelection?: () => void
  onSubmitComposer?: () => void
  onFocusSearch?: () => void
}

const IGNORED_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

function isInsideCombobox(el: Element | null): boolean {
  return Boolean(el?.closest('[role="combobox"], [role="listbox"]'))
}

export function createKeyboardNavHandler(opts: UseKeyboardNavOptions) {
  return function onKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement
    if (IGNORED_TAGS.has(target.tagName)) return
    // biome-ignore lint/suspicious/noExplicitAny: guard for non-browser test envs
    if (typeof document !== 'undefined' && isInsideCombobox(document.activeElement)) return

    // Cmd+Enter must be checked before plain Enter
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      opts.onSubmitComposer?.()
    } else if (e.key === 'j') {
      e.preventDefault()
      opts.onSelectNext?.()
    } else if (e.key === 'k') {
      e.preventDefault()
      opts.onSelectPrev?.()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      opts.onOpenSelected?.()
    } else if (e.key === 'Escape') {
      opts.onClearSelection?.()
    } else if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      opts.onFocusSearch?.()
    }
  }
}

export function useKeyboardNav(opts: UseKeyboardNavOptions) {
  const optsRef = useRef(opts)
  optsRef.current = opts

  useEffect(() => {
    function listener(e: KeyboardEvent) {
      createKeyboardNavHandler(optsRef.current)(e)
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  return {
    focusSearch: useCallback(() => optsRef.current.onFocusSearch?.(), []),
    selectNext: useCallback(() => optsRef.current.onSelectNext?.(), []),
    selectPrev: useCallback(() => optsRef.current.onSelectPrev?.(), []),
    openSelected: useCallback(() => optsRef.current.onOpenSelected?.(), []),
    clearSelection: useCallback(() => optsRef.current.onClearSelection?.(), []),
    submitComposer: useCallback(() => optsRef.current.onSubmitComposer?.(), []),
  }
}
